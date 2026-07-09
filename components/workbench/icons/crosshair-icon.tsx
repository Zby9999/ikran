"use client";

/** Figma 230:320 crosshair — centered in its own viewBox (Hugeicons CrosshairIcon is offset). */
export function CrosshairIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 12.5416 12.5418"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="6.27079"
        cy="6.27091"
        r="4.66667"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.27079 6.12508V6.27091M6.56246 6.27091C6.56246 6.43197 6.43185 6.56258 6.27079 6.56258C6.10973 6.56258 5.97913 6.43197 5.97913 6.27091C5.97913 6.1098 6.10973 5.97925 6.27079 5.97925C6.43185 5.97925 6.56246 6.1098 6.56246 6.27091Z"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.27075 0.4375V2.77083"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.27075 9.771V12.1043"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.1041 6.27085L9.77075 6.27026"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.77083 6.271H0.4375"
        stroke="currentColor"
        strokeWidth="0.875"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
