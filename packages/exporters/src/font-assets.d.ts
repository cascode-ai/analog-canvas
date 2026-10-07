// The editor's bundler serves an imported font file as an asset and hands
// the importer its URL.
declare module "*.ttf?url" {
  const url: string;
  export default url;
}
declare module "*.woff?url" {
  const url: string;
  export default url;
}
