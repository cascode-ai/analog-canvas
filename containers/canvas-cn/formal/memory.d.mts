export function collectRegionalGarbage(): void;
export function regionalMemoryStatus(): {
  enabled: boolean;
  collections: number;
  lastCollectionAt: number;
};
