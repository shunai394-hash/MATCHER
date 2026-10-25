"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

// Lifestyle photos are decorative support for the copy. If one fails to load, hide it
// and let the container's background show instead of a broken-image icon.
export function SceneImage(props: ImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <Image {...props} alt={props.alt} onError={() => setFailed(true)} />;
}
