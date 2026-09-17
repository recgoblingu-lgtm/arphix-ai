import { pipeline, env } from '@huggingface/transformers';

// The model can be replaced with a GitHub-hosted ONNX model at build time or from the console:
// window.ARPHIX_MODEL_ID = './models/arphix-coder';
const DEFAULT_MODEL = 'onnx-community/Qwen2.5-Coder-0.5B-Instruct-ONNX';
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;

let generatorPromise;
let activeBackend = null;
let lastProgress = 0;

function modelId() {
  return globalThis.ARPHIX_MODEL_ID || localStorage.getItem('arphix-model-id') || DEFAULT_MODEL;
}

function progressLabel(progress) {
  if (!progress || typeof progress.progress !== 'number') return;
  const next = Math.round(progress.progress);
  if (next !== lastProgress) {
    lastProgress = next;
    globalThis.dispatchEvent(new CustomEvent('arphix:model-progress', { detail: { progress: next, file: progress.file || '' } }));
  }
}

async function loadGenerator() {
  if (generatorPromise) return generatorPromise;
  generatorPromise = (async () => {
    const options = { dtype: 'q4', progress_callback: progressLabel };
    if ('gpu' in navigator) {
      try {
        const generator = await pipeline('text-generation', modelId(), { ...options, device: 'webgpu' });
        activeBackend = 'WebGPU';
        return generator;
      } catch (error) {
        globalThis.dispatchEvent(new CustomEvent('arphix:model-fallback', { detail: { from: 'WebGPU', error: error.message } }));
      }
    }
    const generator = await pipeline('text-generation', modelId(), { ...options, device: 'wasm' });
    activeBackend = 'WASM';
    return generator;
  })().catch((error) => {
    generatorPromise = undefined;
    throw error;
  });
  return generatorPromise;
}

function promptFor({ system, prompt }) {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
}

export async function generateLocalModelReply({ system, prompt, onStatus }) {
  onStatus?.('Loading local model…');
  const generator = await loadGenerator();
  onStatus?.(`Generating with ${activeBackend}…`);
  const output = await generator(promptFor({ system, prompt }), { max_new_tokens: 420, temperature: 0.55, do_sample: true, return_full_text: false });
  const content = output?.[0]?.generated_text?.trim();
  if (!content) throw new Error('The local model returned no text.');
  return { content, mode: `browser-local-${activeBackend.toLowerCase()}`, backend: activeBackend, model: modelId() };
}

export function localModelLabel() {
  return activeBackend ? `browser local · ${activeBackend}` : 'browser local · not loaded';
}
