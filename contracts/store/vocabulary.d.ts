// contracts/store/vocabulary.d.ts — hand-written types for vocabulary.js.
//
// HAND-WRITTEN, for the reason ../README.md gives: nothing in this directory may
// require a build step to consume, so the module stays plain JavaScript and its
// types are declared beside it rather than compiled out of it. A TypeScript
// consumer imports `./vocabulary.js` and gets exactly these types.

export type Surface = 'app' | 'extension';
export type ChannelKind = 'web' | 'store' | 'direct';
export type ListingFieldKind = 'doc' | 'text' | 'url' | 'json' | 'image';
export type AppListingScope = 'required' | 'additional' | null;
export type ExtensionListingScope = 'per-store' | 'shared' | null;

export interface ListingField {
  readonly name: string;
  readonly kind: ListingFieldKind;
  readonly app: AppListingScope;
  readonly extension: ExtensionListingScope;
  readonly rendered: boolean;
}

export const CHANNEL_IDS: readonly string[];
export const SURFACES: readonly Surface[];
export const CHANNEL_KINDS: readonly ChannelKind[];
export const PLATFORMS: readonly string[];
export const STOREFRONT_KEYS: readonly string[];
export const EXTENSION_STORE_KEYS: readonly string[];
export const ARTIFACT_FORMATS: readonly string[];
export const DEVICE_CLASSES: readonly string[];
export const LISTING_FIELDS: readonly ListingField[];
export const LISTING_CATEGORIES: Readonly<Record<string, readonly string[]>>;

export function appRequiredListingFiles(): string[];
export function appAdditionalListingFiles(): string[];
export function urlListingFiles(): string[];
export function extensionPerStoreListingFiles(): string[];
export function extensionSharedListingFiles(): string[];
export function renderedListingFiles(): string[];
export function allListingFiles(): string[];

export interface StoreVocabulary {
  readonly channelIds: readonly string[];
  readonly surfaces: readonly Surface[];
  readonly channelKinds: readonly ChannelKind[];
  readonly platforms: readonly string[];
  readonly storefrontKeys: readonly string[];
  readonly extensionStoreKeys: readonly string[];
  readonly artifactFormats: readonly string[];
  readonly deviceClasses: readonly string[];
  readonly listingFields: readonly ListingField[];
  readonly listingCategories: Readonly<Record<string, readonly string[]>>;
}

export const STORE_VOCABULARY: StoreVocabulary;
export const VOCABULARY_AXES: readonly (keyof StoreVocabulary)[];
