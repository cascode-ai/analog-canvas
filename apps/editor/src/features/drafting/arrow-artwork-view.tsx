import {
  arrowArtwork,
  arrowPathData,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { DraftingObject, Point } from "@icm/model";

export function ArrowArtworkView({
  object,
  points,
  controls = [],
  profile,
  color,
}: {
  object: Pick<
    Extract<DraftingObject, { kind: "arrow" }>,
    "styleOverride" | "outline"
  >;
  points: readonly Point[];
  controls?: readonly (Point | null)[];
  profile: SchematicStyleProfile;
  color: string;
}) {
  const art = arrowArtwork(object, points, controls, profile);
  const serialize = (values: readonly Point[]) =>
    values.map((p) => `${p.x},${p.y}`).join(" ");
  const dash = object.styleOverride?.lineStyle;
  return (
    <g
      stroke={color}
      strokeWidth={art.strokeWidth}
      strokeLinecap={profile.lineCap}
      strokeLinejoin={profile.lineJoin}
      strokeMiterlimit={profile.miterLimit}
    >
      {art.outline ? (
        <polygon
          points={serialize(art.outline)}
          fill="none"
          strokeDasharray={
            dash === "dashed" ? "6 4" : dash === "dotted" ? "2 3" : undefined
          }
        />
      ) : (
        <>
          <path
            d={arrowPathData(art.shaft, art.controls)}
            fill="none"
            strokeDasharray={
              dash === "dashed" ? "6 4" : dash === "dotted" ? "2 3" : undefined
            }
          />
          {art.heads.map((head, index) => (
            <polygon
              key={index}
              points={serialize(head)}
              fill={art.headStyle === "open" ? "none" : color}
              stroke={art.headStyle === "open" ? color : "none"}
            />
          ))}
        </>
      )}
    </g>
  );
}
