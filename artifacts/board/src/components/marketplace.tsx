import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, ArrowUpRight, MapPin, Plus, Search, Sparkles, Tag } from "lucide-react";
import type { Listing } from "@workspace/api-client-react";

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", description);
  }, [title, description]);
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <div className="market-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" data-testid="link-home">
          <span className="brand-mark"><span /></span>
          <span>соседи<span className="brand-dot">.</span></span>
        </Link>
        <div className="topbar-note"><span className="live-dot" /> Рядом с вами, каждый день</div>
        <Link href="/new" className={`publish-link ${location === "/new" ? "active" : ""}`} data-testid="link-publish">
          <Plus size={17} strokeWidth={2.5} /> <span>Разместить объявление</span>
        </Link>
      </div>
    </header>
    <main>{children}</main>
    <footer className="site-footer"><span className="footer-brand">соседи<span>.</span></span><span>Хорошие вещи находят новых хозяев.</span><Link href="/new">Есть что предложить? <ArrowUpRight size={14} /></Link></footer>
  </div>;
}

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`page-container ${className}`}>{children}</div>;
}

export function Price({ value, large = false }: { value: number; large?: boolean }) {
  return <span className={large ? "price price-large" : "price"}>{new Intl.NumberFormat("ru-RU").format(value)}<span className="rub"> ₽</span></span>;
}

export function ListingCard({ listing, featured = false }: { listing: Listing; featured?: boolean }) {
  const date = new Date(listing.createdAt);
  const dateLabel = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
  return <Link href={`/listing/${listing.id}`} className={`listing-card ${featured ? "featured-card" : ""}`} data-testid={`link-listing-${listing.id}`}>
    <div className="card-image">
      {listing.imageUrl ? <img src={listing.imageUrl} alt={listing.title} loading="lazy" /> :
        <div className={`image-placeholder tone-${listing.id % 5}`} aria-label="Изображение не добавлено">
          <span className="placeholder-orbit orbit-one" /><span className="placeholder-orbit orbit-two" />
          <span className="placeholder-glyph">{listing.category.slice(0, 1).toLocaleUpperCase("ru")}</span>
          <span className="placeholder-caption">из рук в руки</span>
        </div>}
      {featured && <span className="featured-flag"><Sparkles size={12} /> Выбор соседей</span>}
      <span className="condition-pill">{listing.condition === "new" ? "Новое" : "Б/у"}</span>
    </div>
    <div className="card-content">
      <div className="card-meta"><span>{listing.category}</span>{dateLabel && <span>{dateLabel}</span>}</div>
      <h3>{listing.title}</h3>
      <div className="card-bottom"><Price value={listing.price} /><span className="card-city"><MapPin size={13} />{listing.city}</span></div>
    </div>
  </Link>;
}

export function PageHeading({ eyebrow, title, description, backHref = "/", backLabel = "К объявлениям" }: {
  eyebrow: string; title: string; description?: string; backHref?: string; backLabel?: string;
}) {
  return <div className="page-heading">
    <Link className="back-link" href={backHref} data-testid="link-back"><ArrowLeft size={15} /> {backLabel}</Link>
    <div className="heading-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
  </div>;
}

export function InlineError({ onRetry, message = "Не удалось загрузить данные. Попробуйте ещё раз." }: { onRetry: () => void; message?: string }) {
  return <div className="state-panel error-panel"><div className="state-icon error-icon">!</div><h3>Что-то пошло не так</h3><p>{message}</p><button className="text-button" onClick={onRetry} data-testid="button-retry">Повторить <ArrowRight size={15} /></button></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel empty-panel"><div className="empty-art"><span /><span /><span /></div><span className="eyebrow">ПОКА ТИХО</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return <div className="listing-grid" aria-label="Загружаем объявления">{Array.from({ length: count }, (_, i) => <div className="skeleton-card" key={i}><div className="skeleton-image shimmer" /><div className="skeleton-line shimmer short" /><div className="skeleton-line shimmer" /><div className="skeleton-line shimmer medium" /></div>)}</div>;
}

export function SearchBox({ value, onChange, placeholder = "Что ищем по соседству?" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-box"><Search size={20} /><input data-testid="input-search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /><span className="search-shortcut">⌕</span></label>;
}

export function CategoryIcon({ name }: { name: string }) {
  return <span className="category-icon"><Tag size={15} /></span>;
}
