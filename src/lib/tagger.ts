import type { MediaRef } from './thumbs.ts';
import { getFile, type Dir } from './fs.ts';
import type { ProgressInfo } from '@huggingface/transformers';
import { idbDelete, idbGet, idbSet } from './idb.ts';

export interface TaggerModel {
    id: string;
    label: string;
    size: string;
    description: string;
    model: string;
    kind: 'art-tags' | 'semantic';
    license: string;
    url: string;
    dtype: 'fp32' | 'q8';
    task: 'zero-shot-image-classification' | 'wd-tagger' | 'onnx-image-classification';
    candidates: string[];
    custom?: boolean;
}

export const TAGGER_MODELS: TaggerModel[] = [
    {
        id: 'clip-vit-base-patch32',
        label: 'CLIP ViT-B/32',
        size: '~354 MB quantized',
        description: 'A local zero-shot vision model for art references: subjects, mood, aesthetic, medium, and motifs.',
        model: 'Xenova/clip-vit-base-patch32',
        kind: 'semantic',
        license: 'Apache-2.0',
        url: 'https://huggingface.co/Xenova/clip-vit-base-patch32',
        dtype: 'q8',
        task: 'zero-shot-image-classification',
        candidates: [
            'character design', 'creature design', 'environment design', 'costume design', 'portrait', 'figure',
            'animal', 'architecture', 'interior', 'landscape', 'still life', 'prop design', 'vehicle',
            'digital painting', 'concept art', 'illustration', 'anime', 'comic art', 'watercolor', 'oil painting',
            'pencil sketch', 'line art', 'ink drawing', 'collage', '3d render', 'photograph', 'pixel art',
            'abstract', 'minimalist', 'maximalist', 'surreal', 'geometric', 'ornate', 'organic', 'textured',
            'warm', 'cool', 'muted', 'pastel', 'vibrant', 'monochrome', 'dark', 'bright', 'calm', 'dreamy',
            'eerie', 'dramatic', 'playful', 'melancholic', 'romantic', 'futuristic', 'vintage', 'whimsical',
            'floral motif', 'geometric motif', 'clouds', 'water', 'mountains', 'forest', 'stars', 'fire',
            'flowers', 'foliage', 'weapons', 'armor', 'machinery', 'buildings', 'windows', 'textile pattern',
        ],
    },
    {
        id: 'wd-vit-tagger-v3',
        label: 'WD ViT Tagger v3',
        size: '~379 MB',
        description: 'A local anime and illustration tagger trained on Danbooru labels.',
        model: 'SmilingWolf/wd-vit-tagger-v3',
        kind: 'art-tags',
        license: 'MIT',
        url: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3',
        dtype: 'fp32',
        task: 'wd-tagger',
        candidates: [],
    },
];

const MODEL_KEY = 'hoard:tagger-model';
const READY_KEY = 'hoard:tagger-ready';
const CUSTOM_MODELS_KEY = 'hoard:tagger-custom-models';
const CUSTOM_ASSET_PREFIX = 'hoard:tagger-asset:';
let selectedId = TAGGER_MODELS[0].id;
let customModels: TaggerModel[] = [];
let loadedId: string | null = null;
let classifier: ((input: Blob) => Promise<Array<{ label: string; score: number }>>) | null = null;
type Classifier = (input: Blob) => Promise<Array<{ label: string; score: number }>>;
const classifierCache = new Map<string, Classifier>();
const loadingModels = new Map<string, Promise<Classifier>>();

void idbGet<string>('kv', MODEL_KEY).then((value) => {
    if (value) selectedId = value;
});
void idbGet<TaggerModel[]>('kv', CUSTOM_MODELS_KEY).then((value) => {
    if (value) customModels = value?.filter((model) => model.custom) ?? [];
});
export function taggerModels(): TaggerModel[] {
    return [...TAGGER_MODELS, ...customModels];
}
export async function loadTaggerModels(): Promise<TaggerModel[]> {
    const value = await idbGet<TaggerModel[]>('kv', CUSTOM_MODELS_KEY);
    if (value) customModels = value.filter((model) => model.custom);
    return taggerModels();
}
export function selectedTaggerModel(): TaggerModel | null {
    return taggerModels().find((model) => model.id === selectedId) ?? TAGGER_MODELS[0];
}

export function setSelectedTaggerModel(id: string): void {
    if (!taggerModels().some((model) => model.id === id)) return;
    selectedId = id;
    void idbSet('kv', MODEL_KEY, id);
    activateCachedModel(selectedTaggerModel()?.model ?? '');
}

export function activeTaggerModel(): TaggerModel {
    return selectedTaggerModel() ?? TAGGER_MODELS[0];
}

function modelSource(value: string): string {
    const model = value.trim();
    if (!model.startsWith('https://huggingface.co/')) return model;
    return model.replace(/^https:\/\/huggingface\.co\//, '').replace(/\/tree\/main\/?$/, '').replace(/\/$/, '');
}

export async function addTaggerModel(repo: string, label: string): Promise<TaggerModel> {
    const source = modelSource(repo);
    if (!source || source.includes('://') || source.split('/').length < 2) throw new Error('Enter a Hugging Face model repository such as owner/model');
    const id = `custom-${source.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const model: TaggerModel = {
        id,
        label: label.trim() || source,
        size: 'download on demand',
        description: 'Custom Hugging Face ONNX image classification model.',
        model: source,
        kind: 'semantic',
        license: 'See repository',
        url: `https://huggingface.co/${source}`,
        dtype: 'fp32',
        task: 'onnx-image-classification',
        candidates: [],
        custom: true,
    };
    customModels = [...customModels.filter((item) => item.id !== id), model];
    await idbSet('kv', CUSTOM_MODELS_KEY, customModels);
    return model;
}

export async function deleteTaggerModel(id: string): Promise<void> {
    if (!taggerModels().some((model) => model.id === id)) return;
    classifierCache.delete(modelSource(taggerModels().find((model) => model.id === id)?.model ?? ''));
    await idbDelete('kv', `${READY_KEY}:${id}`);
    await idbDelete('kv', `${CUSTOM_ASSET_PREFIX}${id}:model.onnx`);
    await idbDelete('kv', `${CUSTOM_ASSET_PREFIX}${id}:selected_tags.csv`);
    if (id === selectedId) {
        selectedId = TAGGER_MODELS[0].id;
        await idbSet('kv', MODEL_KEY, selectedId);
        activateCachedModel(modelSource(TAGGER_MODELS[0].model));
    }
    customModels = customModels.filter((model) => model.id !== id);
    await idbSet('kv', CUSTOM_MODELS_KEY, customModels);
}

export async function loadTaggerModel(onProgress?: (value: number) => void): Promise<void> {
    const model = activeTaggerModel();
    const modelId = modelSource(model.model);
    if (loadedId === modelId && classifier) return;
    const cached = classifierCache.get(modelId);
    if (cached) {
        activateModel(modelId, cached);
        return;
    }
    let loading = loadingModels.get(modelId);
    if (!loading) {
        loading = (async () => {
            if (model.task === 'wd-tagger') return loadWdTagger(model, onProgress);
            if (model.task === 'onnx-image-classification') return loadGenericOnnx(model, onProgress);
            const { pipeline } = await import('@huggingface/transformers');
            const pipe = await pipeline(model.task, modelId, {
                dtype: model.dtype,
                progress_callback: (event: ProgressInfo) => {
                    if (event.status === 'progress') onProgress?.(event.progress);
                },
            });
            const modelClassifier: Classifier = async (input) =>
                (await pipe(input, model.candidates)) as Array<{ label: string; score: number }>;
            classifierCache.set(modelId, modelClassifier);
            return modelClassifier;
        })();
        loadingModels.set(modelId, loading);
        void loading.then(
            () => loadingModels.delete(modelId),
            () => loadingModels.delete(modelId)
        );
    }

    async function loadWdTagger(model: TaggerModel, onProgress?: (value: number) => void): Promise<Classifier> {
        const { RawImage } = await import('@huggingface/transformers');
        const { InferenceSession, Tensor } = await import('onnxruntime-web');
        const base = `https://huggingface.co/${model.model}/resolve/main/`;
        onProgress?.(0);
        const cachedModel = await idbGet<Blob>('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:model.onnx`);
        const cachedTags = await idbGet<string>('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:selected_tags.csv`);
        const [modelBuffer, tagsCsv] = await Promise.all([
            cachedModel ? cachedModel.arrayBuffer() : fetchAsset(`${base}model.onnx`, model, onProgress),
            cachedTags ?? fetchText(`${base}selected_tags.csv`),
        ]);
        if (!tagsCsv) throw new Error('WD ViT Tagger labels could not be downloaded');
        await idbSet('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:selected_tags.csv`, tagsCsv);
        const labels = tagsCsv.trim().split(/\r?\n/).slice(1).map((line) => {
            const [, name, category] = line.split(',');
            return { name: name.replace(/^"|"$/g, ''), category: Number(category) };
        });
        const session = await InferenceSession.create(new Uint8Array(modelBuffer));
        onProgress?.(100);
        return async (input) => {
            const image = await RawImage.fromBlob(input);
            const resized = await image.rgb().resize(448, 448, { resample: 3 });
            const pixels = new Float32Array(3 * 448 * 448);
            for (let y = 0; y < 448; y++) {
                for (let x = 0; x < 448; x++) {
                    const source = (y * 448 + x) * 3;
                    pixels[y * 448 + x] = (resized.data[source] / 255 - 0.5) / 0.5;
                    pixels[448 * 448 + y * 448 + x] = (resized.data[source + 1] / 255 - 0.5) / 0.5;
                    pixels[2 * 448 * 448 + y * 448 + x] = (resized.data[source + 2] / 255 - 0.5) / 0.5;
                }
            }
            const inputName = session.inputNames[0];
            const output = await session.run({ [inputName]: new Tensor('float32', pixels, [1, 3, 448, 448]) });
            const scores = output[session.outputNames[0]].data as Float32Array;
            return labels
                .map((label, index) => ({ label: label.name, score: 1 / (1 + Math.exp(-scores[index])), category: label.category }))
                .filter((prediction) => prediction.category === 0)
                .sort((a, b) => b.score - a.score)
                .map(({ label, score }) => ({ label, score }));
        };
    }
    async function loadGenericOnnx(model: TaggerModel, onProgress?: (value: number) => void): Promise<Classifier> {
        const { RawImage } = await import('@huggingface/transformers');
        const { InferenceSession, Tensor } = await import('onnxruntime-web');
        const base = `https://huggingface.co/${model.model}/resolve/main/`;
        const cachedModel = await idbGet<Blob>('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:model.onnx`);
        const modelBuffer = cachedModel ? await cachedModel.arrayBuffer() : await fetchAsset(`${base}model.onnx`, model, onProgress);
        let labels: string[] = [];
        const cachedLabels = await idbGet<string>('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:labels.txt`);
        const labelsText = cachedLabels ?? await fetchText(`${base}labels.txt`);
        if (labelsText) labels = labelsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!labels.length) {
            const configText = await fetchText(`${base}config.json`);
            if (configText) {
                const config = JSON.parse(configText) as { id2label?: Record<string, string> };
                labels = Object.entries(config.id2label ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => value);
            }
        }
        const session = await InferenceSession.create(new Uint8Array(modelBuffer));
        const inputName = session.inputNames[0];
        const size = 224;
        return async (input) => {
            const image = await RawImage.fromBlob(input);
            const resized = await image.rgb().resize(size, size, { resample: 3 });
            const pixels = new Float32Array(3 * size * size);
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const source = (y * size + x) * 3;
                pixels[y * size + x] = resized.data[source] / 255;
                pixels[size * size + y * size + x] = resized.data[source + 1] / 255;
                pixels[2 * size * size + y * size + x] = resized.data[source + 2] / 255;
            }
            const output = await session.run({ [inputName]: new Tensor('float32', pixels, [1, 3, size, size]) });
            const scores = Array.from(output[session.outputNames[0]].data as Float32Array);
            return scores.map((score, index) => ({ label: labels[index] ?? `label ${index + 1}`, score: 1 / (1 + Math.exp(-score)) })).sort((a, b) => b.score - a.score);
        };
    }
    async function fetchAsset(url: string, model: TaggerModel, onProgress?: (value: number) => void): Promise<ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not download ${url.split('/').pop()}`);
        const total = Number(response.headers.get('content-length')) || 0;
        const reader = response.body?.getReader();
        if (!reader) {
            const buffer = await response.arrayBuffer();
            await idbSet('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:model.onnx`, new Blob([buffer]));
            await idbSet('kv', `${READY_KEY}:${model.id}`, model.id);
            return buffer;
        }
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            chunks.push(part.value);
            loaded += part.value.length;
            if (total) onProgress?.((loaded / total) * 100);
        }
        const bytes = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        await idbSet('kv', `${CUSTOM_ASSET_PREFIX}${model.id}:model.onnx`, new Blob([bytes]));
        await idbSet('kv', `${READY_KEY}:${model.id}`, model.id);
        return bytes.buffer;
    }
    async function fetchText(url: string): Promise<string | null> {
        const response = await fetch(url);
        return response.ok ? response.text() : null;
    }
    classifier = await loading;
    loadedId = modelId;
    void idbSet('kv', READY_KEY, modelId);
}

export async function taggerModelDownloaded(): Promise<boolean> {
    const model = activeTaggerModel();
    return model.custom
        ? (await idbGet<string>('kv', `${READY_KEY}:${model.id}`)) === model.id
        : (await idbGet<string>('kv', READY_KEY)) === modelSource(model.model);
}

export async function assertTaggerModelReady(): Promise<void> {
    const model = activeTaggerModel();
    const modelId = modelSource(model.model);
    if (loadingModels.has(modelId)) {
        throw new Error('The selected model is still downloading. Please wait for it to finish before tagging.');
    }
    if (!(await taggerModelDownloaded())) {
        throw new Error('The selected model is not downloaded yet. Download it in Tag Graph before running auto-tag.');
    }
}

function activateModel(modelId: string, modelClassifier: Classifier): void {
    loadedId = modelId;
    classifier = modelClassifier;
}

function activateCachedModel(modelId: string): void {
    const cached = classifierCache.get(modelId);
    if (cached) activateModel(modelId, cached);
    else {
        loadedId = null;
        classifier = null;
    }
}

export async function tagWithModel(root: Dir, ref: MediaRef, maxTags: number): Promise<string[]> {
    if (ref.kind !== 'image') throw new Error('Auto-tagging is available for images only');
    await assertTaggerModelReady();
    await loadTaggerModel();
    if (!classifier) throw new Error('Tagger model is not loaded');
    const predictions = await classifier(await getFile(root, ref.path));
    return predictions
        .slice(0, Math.max(1, Math.min(20, maxTags)))
        .map((prediction) => prediction.label.replaceAll('_', ' ').trim().toLowerCase());
}
