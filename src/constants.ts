/** Everything the hub itself serves lives under this prefix. All other paths are mock routes. */
export const HUB_BASE = '/_hub';
/** Nest controller prefix for the management REST API. */
export const API_BASE = '_hub/api';
/** Swagger UI of the live mock endpoints (generated on every request). */
export const MOCK_DOCS_PATH = '/_hub/docs';
export const MOCK_OPENAPI_PATH = '/_hub/openapi.json';
/** Swagger UI of the management API. */
export const MGMT_DOCS_PATH = '_hub/api-docs';
/** Response header added to every mock response: "<endpointId>@v<version>". */
export const MOCK_HEADER = 'x-mock-hub';
