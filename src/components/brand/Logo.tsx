import { cn } from "@/lib/utils";

type LogoVariant = "full" | "mark";
type LogoTone = "dark" | "light";

interface LogoProps {
  variant?: LogoVariant;
  /** "dark" = white wordmark on dark surface (default); "light" = dark wordmark on light surface. */
  tone?: LogoTone;
  className?: string;
  /** Pixel size of the mark. Wordmark scales relative to it. Default 32. */
  size?: number;
  /** Override wordmark text. Default: "Tweak & Build". */
  wordmark?: string;
}

/**
 * Brand logo for app.tweakandbuild.com.
 * Renders a lime rounded-square mark with a dark chevron and the
 * "Tweak & Build" wordmark beside it.
 */
export function Logo({
  variant = "full",
  tone = "dark",
  className,
  size = 32,
  wordmark = "Tweak & Build",
}: LogoProps) {
  const textColor = tone === "dark" ? "text-zinc-50" : "text-zinc-950";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      {variant === "full" && (
        <span
          className={cn(
            "font-semibold tracking-tight",
            textColor
          )}
          style={{ fontSize: Math.round(size * 0.5) }}
        >
          {wordmark}
        </span>
      )}
    </span>
  );
}

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Just the lime rounded-square + chevron mark. Used in the sidebar header,
 * favicon, login screen, proposal header, etc.
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
