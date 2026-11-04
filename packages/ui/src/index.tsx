import React from 'react';
import { formatBrlCents } from '@deck26/contracts';

export const DECK26_COLORS = {
  pinkPrimary: '#F72585',
  pinkBright: '#FF4D9E',
  pinkSoft: '#FFAFCC',
  purpleTertiary: '#7209B7',
  purpleBright: '#8B2FC9',
  blackSecondary: '#111111',
  neutralSurface: '#1A1A1A',
  blackElevated: '#222226',
  white: '#FFFFFF',
  grayMuted: '#9898A0'
} as const;

export interface Deck26LogoProps {
  size?: number;
  variant?: 'dark-circle' | 'pink-ring' | 'compact';
  showHotelSubtitle?: boolean;
}

/**
 * Emblema Vetorial Oficial DECK 26 fiel à logomarca original anexada:
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
          fill={isPinkRing ? '#FFFFFF' : '#111111'}
          stroke="#F72585"
          strokeWidth={isPinkRing ? '6' : '3.5'}
        />
        <text
          x="18"
          y="58"
          fill={isPinkRing ? '#F72585' : '#FFFFFF'}
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
          fill={isPinkRing ? '#F72585' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="35"
        >
          e
        </text>
        <rect
          x="44"
          y="54"
          width="19"
          height="4.2"
          rx="1.5"
          fill="#F72585"
        />
        <text
          x="65"
          y="58"
          fill={isPinkRing ? '#F72585' : '#FFFFFF'}
          fontFamily="Impact, Oswald, 'Arial Black', sans-serif"
          fontWeight="900"
          fontSize="44"
          letterSpacing="-1"
        >
          CK
        </text>
        <text
          x="53.5"
          y="81"
          fill={isPinkRing ? '#7209B7' : '#FFFFFF'}
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
          fill="#F72585"
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
              fontWeight: 800,
              fontSize: '1.15rem',
              letterSpacing: '0.03em',
              color: '#FFFFFF',
              fontFamily: "'Plus Jakarta Sans', sans-serif"
            }}
          >
            DECK <span style={{ color: '#F72585' }}>26</span>
          </span>
          {showHotelSubtitle && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: '#B57EDC',
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

export const MenuPriceBadge: React.FC<MenuPriceBadgeProps> = ({ cents }) => {
  return <span className="d26-price-tag">{formatBrlCents(cents)}</span>;
};
