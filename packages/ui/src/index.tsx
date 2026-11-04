import React from 'react';
import { formatBrlCents } from '@deck26/contracts';

export const DECK26_COLORS = {
  pinkPrimary: '#E6005C',
  pinkBright: '#FF1F78',
  pinkDark: '#C8004E',
  blackDeep: '#070709',
  blackSurface: '#121218',
  blackElevated: '#181820',
  white: '#FFFFFF',
  grayMuted: '#9E9EA9'
} as const;

export interface Deck26LogoProps {
  size?: number;
  variant?: 'dark-circle' | 'pink-ring' | 'compact';
  showHotelSubtitle?: boolean;
}

/**
 * Emblema Vetorial Oficial DECK 26 fiel à logomarca anexada:
 * Tipografia condensada de alto impacto "DeCK" com barra sob o 'e' minúsculo
 * e numeral "2" sobre "6" alinhados verticalmente no eixo central.
 */
export const Deck26Logo: React.FC<Deck26LogoProps> = ({
  size = 52,
  variant = 'dark-circle',
  showHotelSubtitle = false
}) => {
  const isPinkRing = variant === 'pink-ring';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', userSelect: 'none' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Logomarca Deck 26"
      >
        <circle
          cx="60"
          cy="60"
          r="57"
          fill={isPinkRing ? '#FFFFFF' : '#060608'}
          stroke="#E6005C"
          strokeWidth={isPinkRing ? '6' : '3'}
        />
        {/* Letras D e C K com o 'e' sublinhado no topo e 2 / 6 empilhados abaixo */}
        <text
          x="18"
          y="58"
          fill={isPinkRing ? '#E6005C' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="44"
          letterSpacing="-1"
        >
          D
        </text>
        <text
          x="44"
          y="49"
          fill={isPinkRing ? '#E6005C' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="35"
        >
          e
        </text>
        {/* Barra horizontal característica abaixo do 'e' */}
        <rect
          x="44"
          y="54"
          width="19"
          height="4.2"
          rx="1.5"
          fill="#E6005C"
        />
        <text
          x="65"
          y="58"
          fill={isPinkRing ? '#E6005C' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="44"
          letterSpacing="-1"
        >
          CK
        </text>
        {/* Numeral 2 e 6 empilhados verticalmente no centro inferior */}
        <text
          x="53.5"
          y="81"
          fill={isPinkRing ? '#E6005C' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="24"
          textAnchor="middle"
        >
          2
        </text>
        <text
          x="53.5"
          y="104"
          fill="#E6005C"
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="24"
          textAnchor="middle"
        >
          6
        </text>
      </svg>

      {variant !== 'compact' && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{
              fontWeight: 900,
              fontSize: '1.15rem',
              letterSpacing: '0.04em',
              color: '#FFFFFF'
            }}
          >
            DECK <span style={{ color: '#FF1F78' }}>26</span>
          </span>
          {showHotelSubtitle && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: '#9E9EA9',
                textTransform: 'uppercase'
              }}
            >
              Hotel Auto Posto Milla
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export interface MenuPriceBadgeProps {
  cents: number;
}

/**
 * Tag de preço retangular em rosa vibrante idêntica à do cardápio oficial anexado (`R$ 10,00`, `R$ 42,00`).
 */
export const MenuPriceBadge: React.FC<MenuPriceBadgeProps> = ({ cents }) => {
  return <span className="d26-price-tag">{formatBrlCents(cents)}</span>;
};
