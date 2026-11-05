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
      <span role="img" aria-label="Logomarca Deck 26" style={{position:'relative',display:'inline-block',flexShrink:0,width:size,height:size,borderRadius:'50%',overflow:'hidden',background:'#000',outline:isPinkRing?'2px solid #f72585':undefined}}><img src="/brand/deck26-original.jpg" alt="" style={{position:'absolute',width:'152%',maxWidth:'none',height:'auto',left:'-26%',top:'-96%'}}/></span>

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

export { FinancialCharts } from './FinancialCharts.js';
export type { DailySalesPoint, RoomOccupancyPoint } from './FinancialCharts.js';
