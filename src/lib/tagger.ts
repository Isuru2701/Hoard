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
    task: 'zero-shot-image-classification';
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
];

const MODEL_KEY = 'hoard:tagger-model';
const CUSTOM_MODEL_KEY = 'hoard:tagger-custom-model';
const READY_KEY = 'hoard:tagger-ready';
let selectedId = TAGGER_MODELS[0].id;
let customModelValue = '';
let loadedId: string | null = null;
let classifier: ((input: Blob) => Promise<Array<{ label: string; score: number }>>) | null = null;
type Classifier = (input: Blob) => Promise<Array<{ label: string; score: number }>>;
const classifierCache = new Map<string, Classifier>();
const loadingModels = new Map<string, Promise<Classifier>>();

void idbGet<string>('kv', MODEL_KEY).then((value) => {
    if (value && TAGGER_MODELS.some((model) => model.id === value)) selectedId = value;
});
void idbGet<string>('kv', CUSTOM_MODEL_KEY).then((value) => {
    if (value) customModelValue = value;
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

export function customTaggerModel(): string {
    return customModelValue;
}

export function setCustomTaggerModel(value: string): void {
    customModelValue = value.trim();
    void idbSet('kv', CUSTOM_MODEL_KEY, customModelValue);
    activateCachedModel(modelSource(activeTaggerModel().model));
}

export function activeTaggerModel(): TaggerModel {
    const builtin = selectedTaggerModel() ?? TAGGER_MODELS[0];
    if (!customModelValue) return builtin;
    return {
        ...builtin,
        id: `custom:${customModelValue}`,
        label: customModelValue,
        model: customModelValue,
        url: customModelValue.startsWith('https://huggingface.co/') ? customModelValue : `https://huggingface.co/${customModelValue}`,
        size: 'size determined by model files',
    };
}

export function validCustomTaggerModel(value: string): boolean {
    const model = value.trim();
    return /^[\w.-]+\/[\w.-]+$/.test(model) || /^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+(?:\/tree\/main)?\/?$/.test(model);
}

function modelSource(value: string): string {
    const model = value.trim();
    if (!model.startsWith('https://huggingface.co/')) return model;
    return model.replace(/^https:\/\/huggingface\.co\//, '').replace(/\/tree\/main\/?$/, '').replace(/\/$/, '');
}

export async function loadTaggerModel(onProgress?: (value: number) => void): Promise<void> {
    const model = activeTaggerModel();
    const modelId = modelSource(model.model);
    if (customModelValue && !validCustomTaggerModel(customModelValue)) throw new Error('Use a Hugging Face model ID such as org/model or its https://huggingface.co/org/model URL');
    if (loadedId === modelId && classifier) return;
    const cached = classifierCache.get(modelId);
    if (cached) {
        activateModel(modelId, cached);
        return;
    }
    let loading = loadingModels.get(modelId);
    if (!loading) {
        loading = (async () => {
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
