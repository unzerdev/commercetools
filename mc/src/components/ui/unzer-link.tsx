import type { ReactNode } from 'react';

/** A branded external link: always a new tab, always `noreferrer`. */

export const UnzerLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <a className="unzer-link" href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);
