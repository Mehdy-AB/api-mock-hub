import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { usePrefersDark } from '../hooks';

export function JsonEditor({
  value,
  onChange,
  invalid,
  minHeight = '140px',
  maxHeight = '460px',
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  minHeight?: string;
  maxHeight?: string;
}) {
  const dark = usePrefersDark();
  const extensions = useMemo(() => {
    const parse = jsonParseLinter();
    // An empty editor means "no body", so it is not a lint error.
    return [json(), linter((view) => (view.state.doc.toString().trim() ? parse(view) : []), { delay: 300 }), lintGutter()];
  }, []);

  return (
    <div className={`json-editor${invalid ? ' invalid' : ''}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? 'dark' : 'light'}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ foldGutter: true, highlightActiveLineGutter: false }}
      />
    </div>
  );
}
