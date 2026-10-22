import type { MediaRef } from './thumbs.ts';
import { getFile, type Dir } from './fs.ts';
import type { ProgressInfo } from '@huggingface/transformers';
import { idbGet, idbSet } from './idb.ts';

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
    task: 'zero-shot-image-classification' | 'wd-tagger';
    candidates: string[];
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
let selectedId = TAGGER_MODELS[0].id;
let loadedId: string | null = null;
let classifier: ((input: Blob) => Promise<Array<{ label: string; score: number }>>) | null = null;
type Classifier = (input: Blob) => Promise<Array<{ label: string; score: number }>>;
const classifierCache = new Map<string, Classifier>();
const loadingModels = new Map<string, Promise<Classifier>>();

void idbGet<string>('kv', MODEL_KEY).then((value) => {
    if (value && TAGGER_MODELS.some((model) => model.id === value)) selectedId = value;
});
export function selectedTaggerModel(): TaggerModel | null {
    return TAGGER_MODELS.find((model) => model.id === selectedId) ?? TAGGER_MODELS[0];
}

export function setSelectedTaggerModel(id: string): void {
    if (!TAGGER_MODELS.some((model) => model.id === id)) return;
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
        const [modelResponse, tagsResponse] = await Promise.all([fetch(`${base}model.onnx`), fetch(`${base}selected_tags.csv`)]);
        if (!modelResponse.ok || !tagsResponse.ok) throw new Error('WD ViT Tagger files could not be downloaded');
        const [modelBuffer, tagsCsv] = await Promise.all([modelResponse.arrayBuffer(), tagsResponse.text()]);
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
    classifier = await loading;
    loadedId = modelId;
    void idbSet('kv', READY_KEY, modelId);
}

export async function taggerModelDownloaded(): Promise<boolean> {
    return (await idbGet<string>('kv', READY_KEY)) === modelSource(activeTaggerModel().model);
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
    await loadTaggerModel();
    if (!classifier) throw new Error('Tagger model is not loaded');
    const predictions = await classifier(await getFile(root, ref.path));
    return predictions
        .filter((prediction) => prediction.score >= 0.2)
        .slice(0, Math.max(1, Math.min(20, maxTags)))
        .map((prediction) => prediction.label.replaceAll('_', ' ').trim().toLowerCase());
}
