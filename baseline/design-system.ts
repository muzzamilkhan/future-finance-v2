/**
 * Design System for Future Finance
 * 
 * This file contains all design tokens, constants, and utilities for the application.
 * It ensures consistency across the UI and provides a single source of truth for styling.
 * 
 * @see docs/stories/2.1.ui-overhaul.md for design rationale
 */

// ============================================================================
// SPACING SCALE
// ============================================================================

/**
 * Compact spacing scale optimized for information-dense layouts
 * Use these constants instead of arbitrary values for consistency
 */
export const spacing = {
  /** 2px - Minimal spacing for very tight layouts */
  xxs: '0.125rem',
  /** 4px - Extra small spacing for compact elements */
  xs: '0.25rem',
  /** 8px - Small spacing for related elements */
  sm: '0.5rem',
  /** 12px - Medium spacing for grouped content */
  md: '0.75rem',
  /** 16px - Default spacing for most elements */
  base: '1rem',
  /** 24px - Large spacing for section separation */
  lg: '1.5rem',
  /** 32px - Extra large spacing for major sections */
  xl: '2rem',
  /** 48px - 2XL spacing for page-level separation */
  '2xl': '3rem',
} as const;

// ============================================================================
// TYPOGRAPHY SCALE
// ============================================================================

/**
 * Typography scale with responsive sizing
 * Optimized for readability on all devices
 */
export const typography = {
  fontSize: {
    /** 11px - Micro text for labels and metadata */
    xs: '0.6875rem',
    /** 12px - Small text for secondary information */
    sm: '0.75rem',
    /** 14px - Base text size for body content */
    base: '0.875rem',
    /** 16px - Medium text for emphasis */
    md: '1rem',
    /** 18px - Large text for headings */
    lg: '1.125rem',
    /** 20px - Extra large for section headings */
    xl: '1.25rem',
    /** 24px - 2XL for page titles */
    '2xl': '1.5rem',
    /** 30px - 3XL for hero text */
    '3xl': '1.875rem',
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const;

// ============================================================================
// FINANCE-SPECIFIC COLORS
// ============================================================================

/**
 * Finance-specific color utilities
 * These provide semantic meaning for financial data
 */
export const financeColors = {
  /** Green - for positive balances, income, gains */
  income: {
    bg: 'bg-finance-income',
    text: 'text-finance-income',
    border: 'border-finance-income',
    hover: 'hover:bg-finance-income/90',
  },
  /** Red - for negative balances, expenses, losses */
  expense: {
    bg: 'bg-finance-expense',
    text: 'text-finance-expense',
    border: 'border-finance-expense',
    hover: 'hover:bg-finance-expense/90',
  },
  /** Blue - for neutral information, primary actions */
  neutral: {
    bg: 'bg-finance-neutral',
    text: 'text-finance-neutral',
    border: 'border-finance-neutral',
    hover: 'hover:bg-finance-neutral/90',
  },
  /** Yellow/Orange - for warnings, attention needed */
  warning: {
    bg: 'bg-finance-warning',
    text: 'text-finance-warning',
    border: 'border-finance-warning',
    hover: 'hover:bg-finance-warning/90',
  },
  /** Muted orange - for stale/outdated data */
  stale: {
    bg: 'bg-finance-stale',
    text: 'text-finance-stale',
    border: 'border-finance-stale',
    hover: 'hover:bg-finance-stale/90',
  },
} as const;

// ============================================================================
// COMPONENT VARIANTS
// ============================================================================

/**
 * Common component size variants
 */
export const sizes = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
} as const;

/**
 * Button size classes
 */
export const buttonSizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-6 text-base',
} as const;

/**
 * Card padding variants for compact layouts
 */
export const cardPadding = {
  none: 'p-0',
  compact: 'p-2',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

// ============================================================================
// BREAKPOINTS
// ============================================================================

/**
 * Responsive breakpoints matching Tailwind defaults
 */
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// ============================================================================
// ANIMATION DURATIONS
// ============================================================================

/**
 * Standard animation durations
 * Keep animations snappy for better UX
 */
export const duration = {
  fast: '150ms',
  normal: '200ms',
  slow: '300ms',
} as const;

// ============================================================================
// Z-INDEX SCALE
// ============================================================================

/**
 * Z-index scale for layering
 */
export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  modal: 30,
  popover: 40,
  tooltip: 50,
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format currency with proper styling
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Get color class based on amount (positive/negative)
 */
export function getAmountColorClass(amount: number): string {
  if (amount > 0) return financeColors.income.text;
  if (amount < 0) return financeColors.expense.text;
  return 'text-muted-foreground';
}

/**
 * Get background color class based on amount
 */
export function getAmountBgClass(amount: number): string {
  if (amount > 0) return financeColors.income.bg;
  if (amount < 0) return financeColors.expense.bg;
  return 'bg-muted';
}

/**
 * Check if data is stale (older than specified days)
 */
export function isStale(date: Date, maxDays = 7): boolean {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > maxDays;
}

/**
 * Get relative time string (e.g., "2 days ago")
 */
export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// ============================================================================
// ACCESSIBILITY
// ============================================================================

/**
 * Minimum touch target size for mobile (44x44px per Apple HIG)
 */
export const MIN_TOUCH_TARGET = '44px';

/**
 * WCAG AA contrast ratio requirements
 */
export const CONTRAST_RATIOS = {
  normalText: 4.5,
  largeText: 3,
  uiComponents: 3,
} as const;