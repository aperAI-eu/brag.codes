// Official locally bundled logo: https://aperai.eu/assets/logo-lockup-light.svg
export function AperAILogo() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="aperai-logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 290 100"
    >
      <g transform="translate(50,50)">
        <g fill="none" stroke="#C2623B" strokeWidth="2.5" strokeLinecap="round">
          <path d="M-2,-34 A34,34 0 0,0 -2,34" />
          <path d="M-2,34 L-2,28" />
          <path d="M-2,28 A28,28 0 0,1 -2,-28" />
          <path d="M-2,-28 L-2,-22" />
          <path d="M-2,-22 A22,22 0 0,0 -2,22" />
          <path d="M-2,22 L-2,16" />
          <path d="M-2,16 A16,16 0 0,1 -2,-16" />
          <path d="M-2,-16 L-2,-10" />
          <path d="M-2,-10 A10,10 0 0,0 -2,10" />
          <path d="M-2,10 L-2,0" />
        </g>
        <g fill="#7C9070">
          <polygon points="8,-30 32,0 8,30 8,20 22,0 8,-20" />
          <polygon points="22,-24 42,0 22,24 22,16 34,0 22,-16" opacity="0.7" />
          <polygon points="36,-18 52,0 36,18 36,12 46,0 36,-12" opacity="0.4" />
        </g>
      </g>

      <text
        x="110"
        y="62"
        fontFamily="Outfit, sans-serif"
        fontSize="44"
        fontWeight="600"
        letterSpacing="2"
        fill="#2D2D2D"
      >
        aper<tspan fill="#C2623B">AI</tspan>
      </text>
    </svg>
  );
}
