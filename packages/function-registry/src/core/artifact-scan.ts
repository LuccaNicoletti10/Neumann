import { FunctionPublishError } from './errors.js';

const FORBIDDEN = [
  { re: /\brequire\s*\(/, why: 'dynamic require' },
  { re: /\bimport\s*\(/, why: 'dynamic import' },
  { re: /\beval\s*\(/, why: 'eval' },
  { re: /\bnew\s+Function\s*\(/, why: 'Function constructor' },
  { re: /\bchild_process\b/, why: 'child_process' },
  { re: /\bprocess\.(env|exit|binding|dlopen)\b/, why: 'process/env' },
  { re: /\bprocess\b/, why: 'process' },
  { re: /\bDate\.now\s*\(/, why: 'ambient Date.now' },
  { re: /\bMath\.random\s*\(/, why: 'ambient Math.random' },
  { re: /\bfs\b/, why: 'filesystem' },
  { re: /\bnet\b/, why: 'network' },
  { re: /\bhttp\b/, why: 'network' },
  { re: /\bhttps\b/, why: 'network' },
  { re: /\bdgram\b/, why: 'network' },
  { re: /\bworker_threads\b/, why: 'host worker' },
  { re: /\bnapi\b/, why: 'native modules' },
  { re: /\bprocess\.dlopen\b/, why: 'native modules' },
];

export function assertPublishableArtifact(source: string): void {
  const trimmed = source.trim();
  if (!trimmed.startsWith('function')) {
    throw new FunctionPublishError('artifact must be a function expression');
  }
  for (const rule of FORBIDDEN) {
    if (rule.re.test(source)) {
      throw new FunctionPublishError(`forbidden API: ${rule.why}`);
    }
  }
  try {
    // WHY: syntax is validated at publish only; request path loads hashed bytes.
    new Function('input', 'host', `return (${trimmed})(input, host);`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FunctionPublishError(`artifact did not compile: ${message}`);
  }
}
