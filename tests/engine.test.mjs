import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, generateOfflineReply, sanitizeText } from '../web/engine.js';

const architect = { name: 'Archi', role: 'Systems Architect', temperature: 'balanced', traits: ['methodical'] };

test('intent detector recognizes debugging signals', () => {
  const result = detectIntent('Please fix this error in my login function');
  assert.equal(result.intent, 'debug');
  assert.equal(result.label, 'Debug');
  assert.ok(result.confidence >= 0.84);
});

test('intent detector recognizes user interface generation', () => {
  const result = detectIntent('Create an accessible card component');
  assert.equal(result.intent, 'generate_component');
});

test('sanitizer strips tag delimiters and limits length', () => {
  assert.equal(sanitizeText('<script>x</script>'), 'scriptx/script');
  assert.equal(sanitizeText('abcdef', 3), 'abc');
});

test('offline reply carries a privacy statement and component template', () => {
  const reply = generateOfflineReply({ text: 'Build a React card component', personality: architect });
  assert.equal(reply.mode, 'rule-engine');
  assert.match(reply.content, /No prompt, transcript, or code leaves this browser/);
  assert.match(reply.content, /export function ActionCard/);
});

test('offline reply uses personality framing', () => {
  const reply = generateOfflineReply({ text: 'Explain closures', personality: { ...architect, name: 'Nova', temperature: 'warm' } });
  assert.match(reply.content, /Nova here/);
  assert.equal(reply.detection.intent, 'explain');
});
