// Minimal reproduction
const TOOL_CALL_OPEN_RE = /<tool_call\s*=?\s*([\s\S]*?)(?=<tool_call|$)/gi;

const test = '<tool_call={"name": "read_file", "args": {"path": "/tmp/test.txt"}}>';

console.log('source:', TOOL_CALL_OPEN_RE.source);
console.log('test:', TOOL_CALL_OPEN_RE.test(test));
TOOL_CALL_OPEN_RE.lastIndex = 0;
console.log('exec:', TOOL_CALL_OPEN_RE.exec(test));
