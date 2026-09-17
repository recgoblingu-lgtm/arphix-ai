export const APP_VERSION = '0.1.0';

export const DEFAULT_PERSONALITIES = [
  {
    id: 'architect',
    name: 'Archi',
    role: 'Systems Architect',
    voice: 'en-US',
    temperature: 'balanced',
    traits: ['methodical', 'direct', 'security-minded'],
    greeting: 'I map the moving parts first, then we make a change with confidence.',
    color: '#8b5cf6'
  },
  {
    id: 'mentor',
    name: 'Nova',
    role: 'Patient Code Mentor',
    voice: 'en-US',
    temperature: 'warm',
    traits: ['encouraging', 'clear', 'step-by-step'],
    greeting: 'Let’s make the next step understandable, small, and shippable.',
    color: '#22c55e'
  },
  {
    id: 'reviewer',
    name: 'Scout',
    role: 'Pragmatic Reviewer',
    voice: 'en-US',
    temperature: 'precise',
    traits: ['concise', 'risk-aware', 'test-driven'],
    greeting: 'Show me the edge cases and the smallest safe patch.',
    color: '#38bdf8'
  }
];

const INTENT_RULES = [
  { intent: 'debug', label: 'Debug', test: /\b(bug|error|broken|fix|exception|stack trace|not working)\b/i },
  { intent: 'generate_component', label: 'Generate UI', test: /\b(component|button|modal|card|form|navbar|landing page|ui)\b/i },
  { intent: 'generate_function', label: 'Generate logic', test: /\b(function|algorithm|script|implement|write code|create a)\b/i },
  { intent: 'explain', label: 'Explain', test: /\b(explain|why|what does|how does|teach|understand)\b/i },
  { intent: 'review', label: 'Review code', test: /\b(review|refactor|improve|audit|optimize|smell)\b/i },
  { intent: 'test', label: 'Testing', test: /\b(test|spec|coverage|assert|unit test|e2e)\b/i },
  { intent: 'plan', label: 'Plan', test: /\b(plan|roadmap|steps|approach|architecture|design)\b/i }
];

export function sanitizeText(value, maxLength = 12000) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

export function detectIntent(input) {
  const text = sanitizeText(input).toLowerCase();
  if (!text) return { intent: 'chat', label: 'Conversation', confidence: 0.38, signals: [] };
  const match = INTENT_RULES.find((rule) => rule.test.test(text));
  const signals = [];
  if (/```|\b(const|let|function|class|import|return)\b/.test(text)) signals.push('code-context');
  if (/\b(offline|local|private|privacy)\b/.test(text)) signals.push('offline-context');
  if (match) return { intent: match.intent, label: match.label, confidence: signals.length ? 0.93 : 0.84, signals };
  return { intent: 'chat', label: 'Conversation', confidence: 0.62, signals };
}

function topicFrom(text) {
  return sanitizeText(text, 120).replace(/^(can you|please|help me|i need to)\s+/i, '') || 'your request';
}

function codeBlock(language, code) {
  return `\n\n\`\`\`${language}\n${code}\n\`\`\``;
}

function buildCodeTemplate(text, intent) {
  const lower = text.toLowerCase();
  if (intent === 'generate_component' || /component|button|card|form/.test(lower)) {
    return codeBlock('jsx', `export function ActionCard({ title, onAction }) {\n  return (\n    <section className="action-card">\n      <h2>{title}</h2>\n      <button type="button" onClick={onAction}>Run action</button>\n    </section>\n  );\n}`);
  }
  if (intent === 'test') {
    return codeBlock('js', `import test from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('returns a stable result', () => {\n  const actual = subjectUnderTest('input');\n  assert.equal(actual, 'expected');\n});`);
  }
  if (intent === 'debug') {
    return codeBlock('js', `// First isolate the failure boundary.\nfunction safeParse(input) {\n  try {\n    return { ok: true, value: JSON.parse(input) };\n  } catch (error) {\n    return { ok: false, error: error.message };\n  }\n}`);
  }
  return codeBlock('js', `/** Small, testable implementation sketch. */\nexport function normalizeInput(value) {\n  if (typeof value !== 'string') throw new TypeError('value must be a string');\n  return value.trim();\n}`);
}

function personalityFraming(personality, intent) {
  const name = personality?.name ?? 'ARPHIX';
  const style = personality?.temperature ?? 'balanced';
  const trait = personality?.traits?.[0] ?? 'practical';
  const intros = {
    warm: `${name} here — we can make this approachable without hiding the important parts.`,
    precise: `${name} here — I’ll keep the recommendation narrow and verify the risky edges.`,
    balanced: `${name} here — I’ll organize this as a small, reliable change.`
  };
  const focus = {
    generate_component: 'I detected a UI-generation request. Start with an accessible, composable boundary.',
    generate_function: 'I detected an implementation request. Define inputs, outputs, and failure modes before expanding scope.',
    debug: 'I detected a debugging request. Reproduce the symptom, isolate the boundary, then add a regression test.',
    explain: 'I detected an explanation request. I’ll separate the concept, the mechanism, and the practical takeaway.',
    review: 'I detected a review request. I’ll look for correctness, readability, and unintended behavior.',
    test: 'I detected a testing request. Prefer a behavior-focused test with one obvious failure message.',
    plan: 'I detected a planning request. Break it into reversible slices that can each be validated.',
    chat: `I’m in ${trait} collaboration mode. Tell me the language, runtime, or constraint and I’ll narrow it down.`
  };
  return `${intros[style] ?? intros.balanced}\n\n${focus[intent]}`;
}

export function generateOfflineReply({ text, personality }) {
  const clean = sanitizeText(text);
  const detection = detectIntent(clean);
  const topic = topicFrom(clean);
  const framing = personalityFraming(personality, detection.intent);
  const isCodeIntent = ['generate_component', 'generate_function', 'debug', 'test'].includes(detection.intent);
  const next = isCodeIntent
    ? `\n\nFor **${topic}**, here is a local starter you can adapt. Treat it as a deterministic template, not a model-generated claim.`
    : `\n\nFor **${topic}**, choose one concrete acceptance criterion and we can turn it into the next implementation slice.`;
  const guardrail = '\n\n> **Offline runtime:** This reply was produced by ARPHIX’s built-in rule engine. No prompt, transcript, or code leaves this browser.';
  return {
    detection,
    content: `${framing}${next}${isCodeIntent ? buildCodeTemplate(clean, detection.intent) : ''}${guardrail}`,
    mode: 'rule-engine'
  };
}

export function exportConversation({ agent, messages }) {
  const header = [
    '# ARPHIX conversation export',
    '',
    `- **Agent:** ${agent.name} (${agent.role})`,
    `- **Exported:** ${new Date().toISOString()}`,
    `- **Inference mode:** local deterministic rule engine`,
    ''
  ];
  const body = messages.map((message) => `## ${message.role === 'user' ? 'You' : agent.name}\n\n${message.content}\n`).join('\n');
  return `${header.join('\n')}${body}`;
}
