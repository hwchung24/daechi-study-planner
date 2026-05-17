import React from "react";

export const PGR_A4_PAGE_TOTAL = 6;

export function PgrA4Page(props: {
  page: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`pgr-a4-page${props.className ? ` ${props.className}` : ""}`}
      data-page={props.page}
    >
      <div className="pgr-a4-page__content">{props.children}</div>
      <footer className="pgr-a4-page__footer" aria-label={`${props.page}페이지`}>
        <span>{props.page}</span>
        <span className="pgr-a4-page__footer-dot" aria-hidden>
          /
        </span>
        <span>{PGR_A4_PAGE_TOTAL}</span>
      </footer>
    </article>
  );
}
