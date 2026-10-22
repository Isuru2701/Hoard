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
}

export const TAGGER_MODELS: TaggerModel[] = [
    {
        id: 'wd14-vit-v2',
        label: 'WD14 ViT v2',
        size: '~373 MB',
        description: 'Art-focused tagger with a large visual vocabulary. Best for anime, illustration and character art.',
        model: 'SmilingWolf/wd-v1-4-vit-tagger-v2',
        kind: 'art-tags',
        license: 'MIT',
        url: 'https://huggingface.co/SmilingWolf/wd-v1-4-vit-tagger-v2',
        dtype: 'fp32',
    },
    {
        id: 'mobileclip-s2',
        label: 'MobileCLIP-S2',
        size: '<100 MB',
        description: 'Small semantic image model. Good for broad concepts, but requires a prompt vocabulary for tags.',
        model: 'Xenova/mobileclip_s2',
        kind: 'semantic',
        license: 'OpenRAIL-M',
        url: 'https://huggingface.co/Xenova/mobileclip_s2',
        dtype: 'q8',
    },
];

const MODEL_KEY = 'hoard:tagger-model';
const CUSTOM_MODEL_KEY = 'hoard:tagger-custom-model';
let selectedId = TAGGER_MODELS[0].id;
let customModelValue = '';
let loadedId: string | null = null;
let classifier: ((input: Blob) => Promise<Array<{ label: string; score: number }>>) | null = null;

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
    selectedId = id;
    void idbSet('kv', MODEL_KEY, id);
    loadedId = null;
    classifier = null;
}

export function customTaggerModel(): string {
    return customModelValue;
}

export function setCustomTaggerModel(value: string): void {
    const model = value.trim();
    customModelValue = model;
    void idbSet('kv', CUSTOM_MODEL_KEY, model);
    loadedId = null;
    classifier = null;
}

export async function loadTaggerModel(onProgress?: (value: number) => void): Promise<void> {
    const model = selectedTaggerModel() ?? TAGGER_MODELS[0];
    const modelId = customTaggerModel() || model.model;
    if (loadedId === modelId && classifier) return;
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = await pipeline('image-classification', modelId, {
        dtype: model.dtype,
        progress_callback: (event: ProgressInfo) => {
            if (event.status === 'progress') onProgress?.(event.progress);
        },
    });
    classifier = async (input) => (await pipe(input)) as Array<{ label: string; score: number }>;
    loadedId = modelId;
}

export async function tagWithModel(root: Dir, ref: MediaRef, maxTags: number): Promise<string[]> {
    if (ref.kind === 'video') return ['video'];
    await loadTaggerModel();
    if (!classifier) throw new Error('Tagger model is not loaded');
    const predictions = await classifier(await getFile(root, ref.path));
    return predictions
        .filter((prediction) => prediction.score >= 0.2)
        .slice(0, Math.max(1, Math.min(20, maxTags)))
        .map((prediction) => prediction.label.replaceAll('_', ' ').trim().toLowerCase());
}
