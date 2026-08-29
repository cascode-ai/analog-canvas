/**
 * Compatibility facade. Performance-sensitive browser callers should import
 * `browser-raster` or `browser-pdf` so PNG work never pulls in jsPDF.
 */
export { rasterizeFormalSvgInBrowser } from "./browser-raster.js";
export {
  exportFormalArtifactsInBrowser,
  vectorizeFormalSvgInBrowser,
} from "./browser-pdf.js";
