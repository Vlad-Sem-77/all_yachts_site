import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronDown, MapPin, SlidersHorizontal, X } from "lucide-react";
import { useGetFeaturedListings, useListCategories, useListListings } from "@workspace/api-client-react";
import { ListingCard, PageContainer, SearchBox, SiteFrame, SkeletonCards, InlineError, EmptyState, usePageMeta } from "@/components/marketplace";
import { ListListingsSort } from "@workspace/api-client-react";

export default function HomePage() {
  usePageMeta(
    "Доска объявлений рядом — найти и продать | Соседи",
    "Находите и размещайте объявления рядом с домом. Покупайте хорошие вещи у соседей, продавайте то, чем больше не пользуетесь.",
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const params = useMemo(() => ({
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(category ? { category } : {}),
    ...(city.trim() ? { city: city.trim() } : {}),
    ...(min !== "" && Number.isFinite(Number(min)) ? { minPrice: Number(min) } : {}),
    ...(max !== "" && Number.isFinite(Number(max)) ? { maxPrice: Number(max) } : {}),
    sort, page, limit: 12,
  }), [query, category, city, min, max, sort, page]);
  const listings = useListListings(params);
  const featured = useGetFeaturedListings();
  const categories = useListCategories();
  const items = listings.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((listings.data?.total ?? 0) / (listings.data?.limit ?? 12)));
  const categoryItems = categories.data ?? [];
  const categoryFailure = categories.isError;
  const hasFilters = !!(search || category || city || min || max);
  const clearFilters = () => { setSearch(""); setQuery(""); setCategory(""); setCity(""); setMin(""); setMax(""); setPage(1); };
  return <SiteFrame>
    <section className="hero-band">
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="live-dot" /> Жизнь рядом</span>
          <h1>Хорошие вещи<br />живут <em>по соседству.</em></h1>
          <p>Находите нужное в своём районе — и отдавайте вещам новую историю.</p>
          <div className="hero-cta-line"><a href="#catalog" className="hero-scroll" data-testid="link-browse">Смотреть объявления <ArrowRight size={17} /></a><span className="hero-note">Просто. Рядом. По-человечески.</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-sun" /><div className="art-ring ring-a" /><div className="art-ring ring-b" />
          <div className="art-card art-card-back"><span>вещи с историей</span><i /></div>
          <div className="art-card art-card-front"><span className="art-card-label">НАЙДИ СВОЁ</span><strong>Уже<br />совсем<br /><em>рядом</em></strong><span className="art-pin"><MapPin size={18} /></span></div>
          <div className="art-stamp">СОСЕДИ<br />ПОМОГАЮТ</div>
          <span className="art-spark art-spark-one" /><span className="art-spark art-spark-two" />
        </div>
        <div className="hero-bottom"><span><b>01</b> Люди рядом</span><span><b>02</b> Хорошие находки</span><span><b>03</b> Новая жизнь вещей</span></div>
      </div>
    </section>
    <PageContainer>
      <section className="featured-section">
        <div className="section-topline"><div><span className="eyebrow">СНАЧАЛА ПОСМОТРИТЕ</span><h2>Находки недели<span className="accent-period">.</span></h2></div><span className="section-aside">Хорошее не залеживается</span></div>
        {featured.isLoading ? <SkeletonCards count={3} /> : featured.isError ?
          <InlineError onRetry={() => featured.refetch()} message="Не получилось загрузить подборку." /> :
          (featured.data?.length ?? 0) > 0 ? <div className="listing-grid featured-grid">{featured.data!.slice(0, 3).map(item => <ListingCard key={item.id} listing={item} featured />)}</div> :
            <div className="featured-empty">Пока выбираем самое интересное — а объявления уже ждут ниже.</div>}
      </section>
      <section className="catalog-section" id="catalog">
        <div className="catalog-heading"><div><span className="eyebrow">МАРКЕТПЛЕЙС ПО СОСЕДСТВУ</span><h2>Ищем и находим<span className="accent-period">.</span></h2></div><div className="results-count">{listings.data?.total ?? "—"} <span>объявлений</span></div></div>
        <div className="catalog-tools">
          <SearchBox value={search} onChange={setSearch} />
          <button className={`filter-toggle ${filtersOpen ? "selected" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)} data-testid="button-filter-toggle"><SlidersHorizontal size={16} /> Фильтры <ChevronDown size={15} className={filtersOpen ? "rotate" : ""} /></button>
          <label className="sort-select"><span>Сначала</span><select aria-label="Сортировка" value={sort} onChange={e => { setSort(e.target.value as typeof sort); setPage(1); }} data-testid="select-sort"><option value={ListListingsSort.newest}>Свежее</option><option value={ListListingsSort.price_asc}>Дешевле</option><option value={ListListingsSort.price_desc}>Дороже</option></select><ChevronDown size={14} /></label>
        </div>
        <div className="category-row" aria-label="Категории">
          <button className={`category-chip ${!category ? "current" : ""}`} onClick={() => { setCategory(""); setPage(1); }} data-testid="button-category-all">Все объявления</button>
          {categoryFailure ? <button className="category-retry" onClick={() => categories.refetch()}>Не загрузились категории — повторить</button> : categories.isLoading ? <span className="category-loading">Загружаем категории…</span> : categoryItems.map(cat => <button key={cat.name} className={`category-chip ${category === cat.name ? "current" : ""}`} onClick={() => { setCategory(category === cat.name ? "" : cat.name); setPage(1); }} data-testid={`button-category-${cat.name}`}>{cat.name}<span>{cat.count}</span></button>)}
        </div>
        {filtersOpen && <div className="filter-panel">
          <label className="filter-field city-filter"><span>Город или район</span><input value={city} onChange={e => { setCity(e.target.value); setPage(1); }} placeholder="Например, Казань" data-testid="input-city" /></label>
          <div className="filter-field price-filter"><span>Цена, ₽</span><div><input aria-label="Цена от" type="number" min="0" value={min} onChange={e => { setMin(e.target.value); setPage(1); }} placeholder="От" data-testid="input-price-min" /><span>—</span><input aria-label="Цена до" type="number" min="0" value={max} onChange={e => { setMax(e.target.value); setPage(1); }} placeholder="До" data-testid="input-price-max" /></div></div>
          {hasFilters && <button className="clear-filters" onClick={clearFilters} data-testid="button-clear-filters"><X size={14} /> Сбросить всё</button>}
        </div>}
        {listings.isLoading ? <SkeletonCards /> : listings.isError ? <InlineError onRetry={() => listings.refetch()} /> : items.length ? <>
          <div className="listing-grid">{items.map(item => <ListingCard key={item.id} listing={item} />)}</div>
          {totalPages > 1 && <nav className="pagination" aria-label="Страницы объявлений"><button disabled={page <= 1} onClick={() => { setPage(page - 1); document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }); }} data-testid="button-page-prev">Назад</button><span>Страница <b>{page}</b> из {totalPages}</span><button disabled={page >= totalPages} onClick={() => { setPage(page + 1); document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }); }} data-testid="button-page-next">Дальше <ArrowRight size={14} /></button></nav>}
        </> : <EmptyState title={hasFilters ? "Ничего не нашлось" : "Здесь скоро появятся объявления"} description={hasFilters ? "Попробуйте изменить запрос или сбросить часть фильтров." : "Станьте первым, кто поделится полезной вещью с соседями."} action={hasFilters ? <button className="button-secondary" onClick={clearFilters} data-testid="button-empty-clear">Сбросить фильтры</button> : <Link className="button-primary" href="/new">Разместить объявление <ArrowRight size={16} /></Link>} />}
      </section>
      <section className="join-banner"><div><span className="eyebrow">СООБЩЕСТВО РЯДОМ</span><h2>У каждой вещи<br />есть следующий адрес.</h2></div><p>Продайте то, чем не пользуетесь. Найдите то, что давно искали. И пусть хорошее остаётся поблизости.</p><Link href="/new" className="join-cta" data-testid="link-join-publish">Поделиться находкой <ArrowRight size={16} /></Link><span className="join-mark">с.</span></section>
    </PageContainer>
  </SiteFrame>;
}
