import { Link, useParams } from "wouter";
import { useGetListing } from "@workspace/api-client-react";
import { ArrowLeft, MapPin, Phone, Share2, ShieldCheck, Tag } from "lucide-react";
import { InlineError, PageContainer, PageHeading, Price, SiteFrame, usePageMeta } from "@/components/marketplace";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const listing = useGetListing(Number.isFinite(id) && id > 0 ? id : 0);
  usePageMeta(
    listing.data ? `${listing.data.title} — объявление рядом | Соседи` : "Объявление рядом — подробности | Соседи",
    listing.data
      ? `${listing.data.title} в категории «${listing.data.category}», ${listing.data.city}. Цена ${new Intl.NumberFormat("ru-RU").format(listing.data.price)} ₽. Посмотрите объявление на доске «Соседи».`
      : "Подробности объявления на доске «Соседи» — товары и услуги рядом с домом.",
  );
  if (!Number.isFinite(id) || id < 1) return <SiteFrame><PageContainer><PageHeading eyebrow="ОБЪЯВЛЕНИЕ" title="Такого объявления нет" /><Link href="/" className="button-primary">Вернуться к объявлениям</Link></PageContainer></SiteFrame>;
  return <SiteFrame><PageContainer className="detail-container">
    {listing.isLoading ? <div className="detail-loading"><div className="detail-skeleton shimmer" /><div className="detail-skeleton-copy"><span className="skeleton-line shimmer" /><span className="skeleton-line shimmer" /><span className="skeleton-line shimmer" /></div></div> :
      listing.isError ? <InlineError onRetry={() => listing.refetch()} message="Не удалось открыть объявление." /> :
      listing.data ? <><div className="detail-top"><Link href="/" className="back-link" data-testid="link-detail-back"><ArrowLeft size={15} /> Все объявления</Link><button className="share-button" onClick={() => { if (navigator.share) void navigator.share({ title: listing.data!.title, url: window.location.href }); else void navigator.clipboard?.writeText(window.location.href); }} data-testid="button-share"><Share2 size={15} /> Поделиться</button></div>
        <div className="detail-layout">
          <div className="detail-visual">{listing.data.imageUrl ? <img src={listing.data.imageUrl} alt={listing.data.title} /> : <div className={`detail-art tone-${listing.data.id % 5}`}><div className="detail-art-ring" /><span>{listing.data.category.slice(0, 1).toLocaleUpperCase("ru")}</span><small>соседи знают толк</small></div>}</div>
          <article className="detail-copy"><div className="detail-tags"><span><Tag size={13} />{listing.data.category}</span><span>{listing.data.condition === "new" ? "Новое" : "Б/у"}</span></div><h1>{listing.data.title}</h1><Price value={listing.data.price} large /><div className="detail-location"><MapPin size={16} />{listing.data.city}</div><div className="detail-rule" /><h2>О вещи</h2><p className="detail-description">{listing.data.description}</p><div className="seller-card"><div className="seller-avatar">{listing.data.contactName.slice(0, 1).toLocaleUpperCase("ru")}</div><div className="seller-info"><strong>{listing.data.contactName}</strong><span>Ваш сосед · на связи рядом</span></div><ShieldCheck size={19} className="seller-trust" /></div>{listing.data.contactPhone ? <a className="contact-button" href={`tel:${listing.data.contactPhone}`} data-testid="link-contact-phone"><Phone size={17} /> Позвонить соседу</a> : <div className="contact-muted">Телефон не указан. Напишите продавцу при встрече.</div>}<p className="safety-note"><ShieldCheck size={14} /> Договоритесь о встрече в удобном публичном месте.</p></article>
        </div><div className="detail-bottom"><span>Понравилось? Вещь может стать вашей.</span><Link href="/" className="text-button">Смотреть ещё <ArrowLeft size={15} className="flip-icon" /></Link></div>
      </> : null}
  </PageContainer></SiteFrame>;
}
