import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/tfx-logo-horizontal.png`;
  return {
    title: "TFX AutoFlow",
    description: "Convert logistics rate workbooks into clean, normalized CSV files.",
    openGraph: {
      title: "TFX AutoFlow",
      description: "Excel rates in. Clean CSV out.",
      type: "website",
      images: [{ url: imageUrl, width: 2125, height: 236, alt: "TrueFreight Index from FreightRight" }],
    },
    twitter: { card: "summary_large_image", title: "TFX AutoFlow", description: "Excel rates in. Clean CSV out.", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
