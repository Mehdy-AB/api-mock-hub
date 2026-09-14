import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clean, nextId, nowIso } from '../common/util';
import { contentOf, routeKey, routeLabel, sameContent, sanitizeEndpoint } from '../endpoints/route-rules';
import {
  AuthUser,
  Change,
  CHANGE_TYPES,
  Db,
  Endpoint,
  Proposal,
  ProposalKind,
  Settings,
} from '../storage/models';
import { CollectionName, StoreService } from '../storage/store.service';
import { applyChanges, checkApplicable } from './apply';
import { approvalState, changeRoute, changeWithDiff } from './view';

export const PROPOSAL_COLLECTIONS: CollectionName[] = ['endpoints', 'proposals', 'commits'];

export interface ChangeInput {
  type: string;
  endpointId?: string;
  ref?: string;
  baseVersion?: number;
  endpoint?: unknown;
}

export interface ProposalInput {
  title: string;
  message?: string;
  kind?: ProposalKind;
  changes: ChangeInput[];
}

@Injectable()
export class ProposalsService {
  constructor(private readonly store: StoreService) {}

  /** status may be a comma-separated list. full=true returns whole proposals with diffs. */
  list(filter: { status?: string; author?: string; kind?: string; endpointId?: string }, full = false) {
    const { settings, proposals } = this.store.db;
    const statuses = (filter.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const matching = proposals
      .filter(
        (p) =>
          (!statuses.length || statuses.includes(p.status)) &&
          (!filter.author || p.author === filter.author) &&
          (!filter.kind || p.kind === filter.kind) &&
          (!filter.endpointId || p.changes.some((c) => c.endpointId === filter.endpointId)),
      )
      .sort((a, b) => b.id - a.id);
    if (full) return matching.map((p) => this.view(settings, p));
    return matching.map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        author: p.author,
        status: p.status,
        changes: p.changes.map((c) => `${c.type} ${changeRoute(c)}`),
        endpointIds: p.changes.map((c) => c.endpointId).filter((id): id is string => !!id),
        approval: approvalState(settings, p),
        commitId: p.commitId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
  }

  get(id: number) {
    const db = this.store.db;
    return this.view(db.settings, this.find(db, id));
  }

  create(input: ProposalInput, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const p = this.createIn(db, input, user);
      this.autoApplyIfReady(db, p);
      return this.view(db.settings, p);
    });
  }

  update(id: number, input: Partial<ProposalInput>, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const p = this.find(db, id);
      this.assertAuthorOrAdmin(p, user, 'edit');
      this.assertEditable(p);
      let resetReviews = false;
      if (input.title !== undefined) p.title = input.title.trim();
      if (input.message !== undefined) p.message = input.message.trim();
      if (input.kind !== undefined && input.kind !== p.kind) {
        p.kind = input.kind;
        resetReviews = true;
      }
      if (input.changes) {
        p.changes = this.resolveChanges(db, input.changes);
        p.status = 'open';
        delete p.conflicts;
        resetReviews = true;
      }
      if (resetReviews) this.clearReviews(p, user, 'updated the proposal');
      p.updatedAt = nowIso();
      this.autoApplyIfReady(db, p);
      return this.view(db.settings, p);
    });
  }

  /** Re-bases update/delete changes on the current live versions (keeps the desired content). */
  rebase(id: number, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const p = this.find(db, id);
      this.assertAuthorOrAdmin(p, user, 'rebase');
      this.assertEditable(p);
      const byId = new Map(db.endpoints.map((e) => [e.id, e]));
      const errors: string[] = [];
      const rebased = p.changes.map((c, i): Change => {
        if (c.type === 'add') return c;
        const cur = c.endpointId ? byId.get(c.endpointId) : undefined;
        if (!cur) {
          errors.push(`changes[${i}]: ${changeRoute(c)} was deleted. Edit the proposal to drop or re-add it.`);
          return c;
        }
        return { ...c, baseVersion: cur.version, before: structuredClone(cur) };
      });
      if (!errors.length) {
        for (const cf of checkApplicable(db.endpoints, rebased)) errors.push(`changes[${cf.changeIndex}]: ${cf.reason}`);
      }
      if (errors.length) {
        throw new ConflictException({ statusCode: 409, message: 'Proposal still conflicts after rebase', errors });
      }
      p.changes = rebased;
      p.status = 'open';
      delete p.conflicts;
      this.clearReviews(p, user, 'rebased the proposal on the latest endpoints');
      p.updatedAt = nowIso();
      this.autoApplyIfReady(db, p);
      return this.view(db.settings, p);
    });
  }

  review(id: number, decision: 'approve' | 'request-changes', comment: string | undefined, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const p = this.find(db, id);
      if (p.status !== 'open') {
        throw new ConflictException(
          p.status === 'conflict'
            ? `Proposal #${id} has conflicts. The author must rebase or edit it before it can be reviewed.`
            : `Proposal #${id} is already ${p.status}`,
        );
      }
      if (decision === 'approve') this.assertCanApprove(db.settings, p, user);
      const now = nowIso();
      p.reviews = p.reviews.filter((r) => r.reviewer !== user.username);
      p.reviews.push(clean({ reviewer: user.username, role: user.role, decision, comment: comment?.trim() || undefined, at: now }));
      p.updatedAt = now;
      this.autoApplyIfReady(db, p);
      return this.view(db.settings, p);
    });
  }

  comment(id: number, text: string, user: AuthUser) {
    return this.store.write(['proposals'], (db) => {
      const p = this.find(db, id);
      const now = nowIso();
      p.comments.push({ author: user.username, text: text.trim(), at: now });
      p.updatedAt = now;
      return this.view(db.settings, p);
    });
  }

  reject(id: number, reason: string | undefined, user: AuthUser) {
    return this.store.write(['proposals'], (db) => {
      const p = this.find(db, id);
      this.assertEditable(p);
      if (p.author === user.username) {
        throw new ForbiddenException('Authors withdraw their own proposal with /close instead of /reject');
      }
      this.assertCanApprove(db.settings, p, user);
      this.resolve(p, 'rejected', user, reason);
      return this.view(db.settings, p);
    });
  }

  close(id: number, reason: string | undefined, user: AuthUser) {
    return this.store.write(['proposals'], (db) => {
      const p = this.find(db, id);
      this.assertAuthorOrAdmin(p, user, 'close');
      this.assertEditable(p);
      this.resolve(p, 'closed', user, reason);
      return this.view(db.settings, p);
    });
  }

  /** Save changes and apply them at once. Teammates can discard the resulting commit. */
  commitDirect(input: ProposalInput, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      if (!db.settings.allowDirectCommits) {
        throw new ForbiddenException('Saving directly is turned off. Submit a proposal for review instead.');
      }
      const p = this.createIn(db, input, user);
      this.applyIn(db, p, [], { direct: true });
      if (p.status !== 'approved') {
        throw new ConflictException({
          statusCode: 409,
          message: 'The changes could not be applied',
          errors: (p.conflicts ?? []).map((c) => `changes[${c.changeIndex}]: ${c.reason}`),
        });
      }
      return this.view(db.settings, p);
    });
  }

  /**
   * Undo a commit by applying its inverse as a new commit.
   * Refused when a later change touched the same endpoints; discard that one first.
   */
  discardCommit(commitId: number, reason: string | undefined, user: AuthUser) {
    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const commit = db.commits.find((c) => c.id === commitId);
      if (!commit) throw new NotFoundException(`Commit #${commitId} not found`);
      if (commit.revertedBy) {
        throw new ConflictException(`Commit #${commitId} was already discarded in commit #${commit.revertedBy.commitId}`);
      }

      const byId = new Map(db.endpoints.map((e) => [e.id, e]));
      const errors: string[] = [];
      const inverse: Change[] = [];
      for (const c of commit.changes) {
        const label = changeRoute(c);
        const cur = c.endpointId ? byId.get(c.endpointId) : undefined;
        if (c.type === 'add' || c.type === 'update') {
          if (!cur) {
            errors.push(`${label} no longer exists`);
          } else if (!c.after || !sameContent(cur, c.after)) {
            errors.push(`${label} was changed after this commit. Discard the later commit first.`);
          } else if (c.type === 'add') {
            inverse.push({ type: 'delete', endpointId: cur.id, baseVersion: cur.version, before: structuredClone(cur) });
          } else {
            inverse.push({
              type: 'update',
              endpointId: cur.id,
              baseVersion: cur.version,
              before: structuredClone(cur),
              after: contentOf(c.before!),
            });
          }
        } else if (cur) {
          errors.push(`${label} exists again, so its deletion cannot be undone`);
        } else if (c.before) {
          inverse.push({ type: 'add', endpointId: c.endpointId, baseVersion: c.before.version, after: contentOf(c.before) });
        }
      }
      if (!errors.length) for (const cf of checkApplicable(db.endpoints, inverse)) errors.push(cf.reason);
      if (errors.length) {
        throw new ConflictException({ statusCode: 409, message: `Commit #${commitId} cannot be discarded`, errors });
      }

      const now = nowIso();
      const p: Proposal = {
        id: nextId(db.proposals),
        title: `Discard #${commit.id}: ${commit.title}`.slice(0, 200),
        message: reason?.trim() ?? '',
        kind: 'publish',
        author: user.username,
        status: 'open',
        changes: inverse,
        reviews: [],
        comments: [],
        createdAt: now,
        updatedAt: now,
      };
      db.proposals.push(p);
      this.applyIn(db, p, [], { direct: true, revertOf: commit.id });
      commit.revertedBy = { commitId: p.commitId!, by: user.username, at: now };
      // Discarding a discard re-applies the original, which is then live again.
      if (commit.revertOf) {
        const original = db.commits.find((x) => x.id === commit.revertOf);
        if (original?.revertedBy?.commitId === commit.id) delete original.revertedBy;
      }
      return {
        commit: structuredClone({ ...commit, changes: commit.changes.map(changeWithDiff) }),
        discardCommitId: p.commitId!,
      };
    });
  }

  // ----- building blocks, also used by the import service inside its own write -----

  createIn(db: Db, input: ProposalInput, user: AuthUser): Proposal {
    const changes = this.resolveChanges(db, input.changes);
    const now = nowIso();
    const p: Proposal = {
      id: nextId(db.proposals),
      title: input.title.trim(),
      message: input.message?.trim() ?? '',
      kind: input.kind ?? (user.role === 'frontend' ? 'request' : 'publish'),
      author: user.username,
      status: 'open',
      changes,
      reviews: [],
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
    db.proposals.push(p);
    return p;
  }

  autoApplyIfReady(db: Db, p: Proposal): void {
    if (p.status !== 'open') return;
    if (!db.settings.requireApproval) {
      this.applyIn(db, p, []);
      return;
    }
    const state = approvalState(db.settings, p);
    if (state.ready) this.applyIn(db, p, state.approvedBy);
  }

  /** Applies a proposal to the live set, or marks it as conflicting. */
  applyIn(db: Db, p: Proposal, approvedBy: string[], opts: { direct?: boolean; revertOf?: number } = {}): void {
    const now = nowIso();
    const conflicts = checkApplicable(db.endpoints, p.changes);
    if (conflicts.length) {
      p.status = 'conflict';
      p.conflicts = conflicts;
      p.updatedAt = now;
      return;
    }
    const applied = applyChanges(db.endpoints, p.changes, p.author, now);
    db.endpoints = applied.endpoints;
    const commitId = nextId(db.commits);
    db.commits.push({
      id: commitId,
      proposalId: p.id,
      title: p.title,
      message: p.message,
      author: p.author,
      approvedBy,
      changes: applied.changes,
      at: now,
      ...(opts.direct ? { direct: true } : {}),
      ...(opts.revertOf ? { revertOf: opts.revertOf } : {}),
    });
    p.changes = applied.changes;
    p.status = 'approved';
    p.commitId = commitId;
    p.resolvedAt = now;
    p.resolvedBy = approvedBy.join(', ') || p.author;
    p.updatedAt = now;
    delete p.conflicts;

    // Other open proposals may no longer apply; flag them now so authors see it early.
    for (const other of db.proposals) {
      if (other.id === p.id || other.status !== 'open') continue;
      const c = checkApplicable(db.endpoints, other.changes);
      if (c.length) {
        other.status = 'conflict';
        other.conflicts = c;
        other.updatedAt = now;
      }
    }
  }

  view(settings: Settings, p: Proposal) {
    return structuredClone({ ...p, changes: p.changes.map(changeWithDiff), approval: approvalState(settings, p) });
  }

  // ----- internals -----

  private resolveChanges(db: Db, inputs: ChangeInput[]): Change[] {
    const errors: string[] = [];
    const out: Change[] = [];
    const touched = new Set<string>();

    inputs.forEach((c, i) => {
      const at = `changes[${i}]`;
      if (!CHANGE_TYPES.includes(c.type as Change['type'])) {
        errors.push(`${at}.type must be one of ${CHANGE_TYPES.join(', ')}`);
        return;
      }
      const type = c.type as Change['type'];
      let target: Endpoint | undefined;
      if (type !== 'add') {
        target = this.findTarget(db, c);
        if (!target) {
          errors.push(`${at}: endpoint ${c.endpointId ?? c.ref ?? '(give endpointId or ref)'} not found`);
          return;
        }
        const label = routeLabel(target);
        if (touched.has(target.id)) {
          errors.push(`${at}: ${label} is changed more than once in this proposal`);
          return;
        }
        touched.add(target.id);
        if (c.baseVersion !== undefined && c.baseVersion !== target.version) {
          errors.push(
            `${at}: ${label} is now at version ${target.version} but you edited version ${c.baseVersion}. Reload it and try again.`,
          );
          return;
        }
      }
      let after;
      if (type !== 'delete') {
        const r = sanitizeEndpoint(c.endpoint, `${at}.endpoint`);
        if (!r.value) {
          errors.push(...r.errors);
          return;
        }
        after = r.value;
        if (target && sameContent(contentOf(target), after)) {
          errors.push(`${at}: no difference from the live version of ${routeLabel(target)}`);
          return;
        }
      }
      out.push(
        clean({
          type,
          endpointId: target?.id,
          baseVersion: target?.version,
          before: target ? structuredClone(target) : undefined,
          after,
        }),
      );
    });

    if (!errors.length) {
      for (const cf of checkApplicable(db.endpoints, out)) errors.push(`changes[${cf.changeIndex}]: ${cf.reason}`);
    }
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'Invalid changes', errors });
    return out;
  }

  private findTarget(db: Db, c: ChangeInput): Endpoint | undefined {
    if (c.endpointId) return db.endpoints.find((e) => e.id === c.endpointId);
    if (c.ref) {
      const [method, ...rest] = c.ref.trim().split(/\s+/);
      const key = routeKey(method ?? '', rest.join(' '));
      return db.endpoints.find((e) => routeKey(e.method, e.path) === key);
    }
    return undefined;
  }

  private find(db: Readonly<Db>, id: number): Proposal {
    const p = db.proposals.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Proposal #${id} not found`);
    return p;
  }

  private assertAuthorOrAdmin(p: Proposal, user: AuthUser, action: string): void {
    if (p.author !== user.username && user.role !== 'admin') {
      throw new ForbiddenException(`Only the author or an admin can ${action} proposal #${p.id}`);
    }
  }

  private assertEditable(p: Proposal): void {
    if (p.status !== 'open' && p.status !== 'conflict') {
      throw new ConflictException(`Proposal #${p.id} is ${p.status} and can no longer be changed`);
    }
  }

  private assertCanApprove(s: Settings, p: Proposal, user: AuthUser): void {
    // Admins may approve their own proposals; everyone else needs a teammate.
    if (s.approverMustDiffer && p.author === user.username && user.role !== 'admin') {
      throw new ForbiddenException('You cannot approve your own proposal');
    }
    const role = s.requiredApproverRole[p.kind];
    if (role && user.role !== role && user.role !== 'admin') {
      throw new ForbiddenException(`Only ${role} users or admins can approve or reject ${p.kind} proposals`);
    }
  }

  private clearReviews(p: Proposal, user: AuthUser, what: string): void {
    if (!p.reviews.length) return;
    p.reviews = [];
    p.comments.push({ author: 'system', text: `${user.username} ${what}; previous reviews were cleared.`, at: nowIso() });
  }

  private resolve(p: Proposal, status: 'rejected' | 'closed', user: AuthUser, reason?: string): void {
    const now = nowIso();
    p.status = status;
    p.resolvedAt = now;
    p.resolvedBy = user.username;
    p.updatedAt = now;
    if (reason?.trim()) p.comments.push({ author: user.username, text: `${status}: ${reason.trim()}`, at: now });
  }
}
