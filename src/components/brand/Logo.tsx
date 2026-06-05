import { cn } from "@/lib/utils";

type LogoVariant = "full" | "wordmark" | "mark";
type LogoTone = "dark" | "light";

interface LogoProps {
  /** "full" = mark + wordmark + OS pill, "wordmark" = wordmark + OS pill, "mark" = icon only. */
  variant?: LogoVariant;
  /** "dark" = "Tweak" reads as white on a dark surface (default). "light" = "Tweak" reads as near-black on a light surface. */
  tone?: LogoTone;
  /** Pixel size of the mark. Wordmark + OS pill scale relative to it. Default 32. */
  size?: number;
  className?: string;
}

/**
 * Brand logo for app.tweakandbuild.com (the internal platform).
 * Wordmark reads "Tweak&Build OS" — white "Tweak", lime "&Build", and a
 * lime-text OS pill. Distinct from the public Tweak & Build agency mark.
 */
export function Logo({
  variant = "full",
  tone = "dark",
  size = 32,
  className,
}: LogoProps) {
  if (variant === "mark") {
    return <BrandMark size={size} className={className} />;
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {variant === "full" && <BrandMark size={size} />}
      <Wordmark size={size} tone={tone} />
    </span>
  );
}

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Lime rounded-square + dark chevron mark. Used standalone for favicon,
 * PWA icons, collapsed sidebar, and any space-constrained surface.
 */
export function BrandMark({ size = 32, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="14" fill="#a3e635" />
      <path
        d="M42 32L58 50L42 68"
        stroke="#0a0a0a"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface WordmarkProps {
  size: number;
  tone: LogoTone;
}

function Wordmark({ size, tone }: WordmarkProps) {
  const fontSize = Math.round(size * 0.5);
  const pillFontSize = Math.max(9, Math.round(size * 0.32));
  const tweakColor = tone === "dark" ? "text-zinc-50" : "text-zinc-950";
  const pillBorder =
    tone === "dark" ? "border-zinc-700/80 bg-zinc-900/60" : "border-zinc-300 bg-white";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="font-semibold tracking-tight leading-none"
        style={{ fontSize }}
      >
        <span className={tweakColor}>Tweak</span>
        <span className="text-lime-400">&amp;Build</span>
      </span>
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-1.5 py-0.5 font-semibold uppercase leading-none tracking-wider text-lime-400",
          pillBorder
        )}
        style={{ fontSize: pillFontSize }}
        aria-label="OS"
      >
        OS
      </span>
    </span>
  );
}
