import { globalSchematicTypography } from "@icm/derived";

import type { CanvasPropertyOptionPreview } from "./component-property-fields";

import "../../styles/property-option-preview-menu.css";

interface PreviewOption {
  readonly value: string | number | boolean | null;
  readonly label: string;
  readonly preview?: CanvasPropertyOptionPreview;
}

interface ShowPreviewMenuOptions {
  readonly anchor: HTMLElement;
  readonly label: string;
  readonly options: readonly PreviewOption[];
  readonly optionEnabled: readonly boolean[];
  readonly value: unknown;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}

function renderPreview(preview: CanvasPropertyOptionPreview): HTMLElement {
  const root = document.createElement("span");
  root.className = `cm-property-option-preview cm-property-option-preview-${preview.kind}`;
  if (preview.kind === "label") {
    root.style.setProperty(
      "--property-preview-subscript-scale",
      String(globalSchematicTypography.subscriptScale),
    );
    root.style.setProperty(
      "--property-preview-subscript-shift",
      `${globalSchematicTypography.subscriptBaselineShiftEm}em`,
    );
    root.style.setProperty(
      "--property-preview-subscript-gap",
      `${globalSchematicTypography.subscriptHorizontalGapEm}em`,
    );
    const first = document.createElement("span");
    first.className = "cm-property-label-preview-first";
    first.dataset.italic = String(preview.firstItalic);
    first.textContent = preview.first;
    const suffix = document.createElement("span");
    suffix.className = "cm-property-label-preview-suffix";
    suffix.dataset.italic = String(preview.suffixItalic);
    if (preview.subscript) suffix.dataset.subscript = "";
    suffix.textContent = preview.suffix;
    root.append(first, suffix);
    return root;
  }
  if (preview.kind === "scale") {
    root.dataset.target = preview.target;
    root.style.setProperty("--property-preview-scale", String(preview.factor));
    const artwork = document.createElement("span");
    artwork.className = "cm-property-scale-artwork";
    artwork.textContent = preview.target === "font" ? "Aa" : "";
    root.append(artwork);
    return root;
  }
  if (preview.kind === "bulk") {
    for (const text of [preview.device, "→", preview.rail]) {
      const part = document.createElement(text === "→" ? "span" : "strong");
      part.textContent = text;
      root.append(part);
    }
    return root;
  }
  if (preview.kind === "grid") {
    root.dataset.enabled = String(preview.enabled);
    root.dataset.spacing = String(preview.spacing);
    return root;
  }
  if (preview.kind === "angle") {
    root.dataset.mode = preview.mode;
    root.append(document.createElement("span"), document.createElement("span"));
    return root;
  }
  root.dataset.mode = preview.mode;
  root.textContent =
    preview.mode === "auto" ? "↕  ⊕" : preview.mode === "zoom" ? "⊕" : "↕";
  return root;
}

/** Render one top-layer menu only after a user asks to see its examples. */
export function showPropertyOptionPreviewMenu({
  anchor,
  label,
  options,
  optionEnabled,
  value,
  onSelect,
  onClose,
}: ShowPreviewMenuOptions): () => void {
  const menu = document.createElement("div");
  menu.className = "cm-property-preview-menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", `${label} previews`);
  for (const [index, option] of options.entries()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cm-property-preview-option";
    item.disabled = !optionEnabled[index];
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.value === value));
    const text = document.createElement("span");
    text.className = "cm-property-preview-option-label";
    text.textContent = option.label;
    item.append(text);
    if (option.preview) item.append(renderPreview(option.preview));
    item.addEventListener("click", () => {
      onSelect(String(option.value));
      menu.hidePopover();
    });
    menu.append(item);
  }
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (menu.matches(":popover-open")) menu.hidePopover();
    menu.remove();
    onClose();
  };
  menu.addEventListener("toggle", (event) => {
    if ((event as ToggleEvent).newState === "closed") close();
  });
  document.body.append(menu);
  menu.showPopover();
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(anchorRect.right - menuRect.width, innerWidth - menuRect.width - 8))}px`;
  const below = anchorRect.bottom + 6;
  menu.style.top = `${below + menuRect.height <= innerHeight - 8 ? below : Math.max(8, anchorRect.top - menuRect.height - 6)}px`;
  return close;
}
