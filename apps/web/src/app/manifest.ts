import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oculis Auribus",
    short_name: "Oculis",
    description: "Monitoreo legislativo y regulatorio de República Dominicana.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f4",
    theme_color: "#1565a8",
    lang: "es-DO",
    icons: [
      {
        src: "/oculis-mark.png",
        sizes: "1119x474",
        type: "image/png",
      },
    ],
  };
}
