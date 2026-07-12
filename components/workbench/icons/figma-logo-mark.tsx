"use client";

/** Multi-color Figma logo mark (Figma 309:400 panel). */
export function FigmaLogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="18"
      viewBox="0 0 12 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 18c1.657 0 3-1.343 3-3v-3H3c-1.657 0-3 1.343-3 3s1.343 3 3 3Z"
        fill="#0ACF83"
      />
      <path
        d="M0 9c0-1.657 1.343-3 3-3h3v6H3c-1.657 0-3-1.343-3-3Z"
        fill="#A259FF"
      />
      <path
        d="M0 3c0-1.657 1.343-3 3-3h3v6H3C1.343 6 0 4.657 0 3Z"
        fill="#F24E1E"
      />
      <path
        d="M6 0h3c1.657 0 3 1.343 3 3s-1.343 3-3 3H6V0Z"
        fill="#FF7262"
      />
      <path
        d="M12 9c0 1.657-1.343 3-3 3S6 10.657 6 9s1.343-3 3-3 3 1.343 3 3Z"
        fill="#1ABCFE"
      />
    </svg>
  );
}
