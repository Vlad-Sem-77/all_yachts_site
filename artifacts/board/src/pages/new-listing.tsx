import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useListCategories, useCreateListing, getListListingsQueryKey, getGetFeaturedListingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, Check, ImagePlus, LoaderCircle, MapPin, Tag } from "lucide-react";
import type { ListingInput } from "@workspace/api-client-react";
import { PageContainer, PageHeading, SiteFrame, usePageMeta } from "@/components/marketplace";

const schema = z.object({
  title: z.string().min(3, "Добавьте хотя бы 3 символа").max(120, "Не более 120 символов"),
  description: z.string().min(10, "Расскажите немного подробнее").max(4000, "Не более 4000 символов"),
  category: z.string().min(1, "Выберите категорию"),
  price: z.coerce.number().min(0, "Цена не может быть отрицательной"),
  city: z.string().min(1, "Укажите город"),
  condition: z.enum(["new", "used"]),
  contactName: z.string().min(1, "Укажите имя").max(100),
  contactPhone: z.string().max(40, "Не более 40 символов").optional(),
  imageUrl: z.union([z.literal(""), z.string().url("Укажите корректную ссылку на изображение")]).optional(),
});
type FormValues = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export default function NewListingPage() {
  usePageMeta(
    "Разместить объявление — доска объявлений | Соседи",
    "Опубликуйте объявление о продаже или услуге рядом с домом. Укажите описание, цену и способ связи — это бесплатно.",
  );
  const categoriesQuery = useListCategories();
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const createListing = useCreateListing();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", category: "", price: 0, city: "", condition: "used", contactName: "", contactPhone: "", imageUrl: "" },
  });
  const submit = (values: FormOutput) => {
    const data: ListingInput = { ...values, price: Number(values.price), ...(values.contactPhone ? { contactPhone: values.contactPhone } : {}), ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}) };
    delete (data as Partial<ListingInput>).imageUrl;
    if (values.imageUrl) data.imageUrl = values.imageUrl;
    createListing.mutate({ data }, {
      onSuccess: async listing => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListListingsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetFeaturedListingsQueryKey() }),
        ]);
        navigate(`/listing/${listing.id}`);
      },
    });
  };
  return <SiteFrame><PageContainer className="form-page">
    <PageHeading eyebrow="НОВАЯ ИСТОРИЯ" title="Поделитесь находкой." description="Пара деталей — и вещь уже ищет нового хозяина." />
    <div className="form-layout">
      <form className="listing-form" onSubmit={form.handleSubmit(submit)} noValidate>
        <div className="form-section"><div className="form-section-heading"><span className="step-number">01</span><div><h2>Что отдаёте?</h2><p>Чем точнее описание, тем скорее найдётся покупатель.</p></div></div>
          <div className="form-field"><label htmlFor="title">Название <span>*</span></label><input id="title" maxLength={120} placeholder="Например, кресло для чтения" {...form.register("title")} data-testid="input-title" />{form.formState.errors.title && <small>{form.formState.errors.title.message}</small>}</div>
          <div className="form-field"><label htmlFor="description">Описание <span>*</span></label><textarea id="description" rows={5} maxLength={4000} placeholder="Расскажите о состоянии, особенностях и почему вещь вам нравилась…" {...form.register("description")} data-testid="input-description" />{form.formState.errors.description && <small>{form.formState.errors.description.message}</small>}</div>
          <div className="form-two-columns"><div className="form-field"><label htmlFor="category">Категория <span>*</span></label><select id="category" {...form.register("category")} data-testid="select-category"><option value="">Выберите категорию</option>{categories.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}</select>{categoriesQuery.isError && <small className="form-hint">Категории не загрузились. <button type="button" onClick={() => categoriesQuery.refetch()}>Повторить</button></small>}{categoriesQuery.isLoading && <small className="form-hint">Загружаем категории…</small>}{form.formState.errors.category && <small>{form.formState.errors.category.message}</small>}</div><div className="form-field"><label htmlFor="price">Цена, ₽ <span>*</span></label><input id="price" type="number" min="0" step="1" placeholder="0" {...form.register("price")} data-testid="input-price" />{form.formState.errors.price && <small>{form.formState.errors.price.message}</small>}</div></div>
          <div className="form-field"><label>Состояние <span>*</span></label><div className="condition-options"><label className={`condition-option ${form.watch("condition") === "used" ? "checked" : ""}`}><input type="radio" value="used" {...form.register("condition")} /><span>Б/у</span><small>Бережно использовалась</small></label><label className={`condition-option ${form.watch("condition") === "new" ? "checked" : ""}`}><input type="radio" value="new" {...form.register("condition")} /><span>Новое</span><small>Ни разу не использовалась</small></label></div></div>
          <div className="form-field"><label htmlFor="imageUrl">Ссылка на фото <span className="optional">необязательно</span></label><div className="input-with-icon"><ImagePlus size={17} /><input id="imageUrl" type="url" placeholder="https://…" {...form.register("imageUrl")} data-testid="input-image-url" /></div>{form.formState.errors.imageUrl && <small>{form.formState.errors.imageUrl.message}</small>}<span className="field-hint">Добавьте прямую ссылку на изображение — карточка станет заметнее.</span></div>
        </div>
        <div className="form-section"><div className="form-section-heading"><span className="step-number">02</span><div><h2>Кто на связи?</h2><p>Покупатель будет знать, кому написать.</p></div></div>
          <div className="form-two-columns"><div className="form-field"><label htmlFor="contactName">Ваше имя <span>*</span></label><input id="contactName" placeholder="Как к вам обращаться" {...form.register("contactName")} data-testid="input-contact-name" />{form.formState.errors.contactName && <small>{form.formState.errors.contactName.message}</small>}</div><div className="form-field"><label htmlFor="contactPhone">Телефон <span className="optional">необязательно</span></label><input id="contactPhone" type="tel" placeholder="+7 900 000-00-00" {...form.register("contactPhone")} data-testid="input-contact-phone" />{form.formState.errors.contactPhone && <small>{form.formState.errors.contactPhone.message}</small>}</div></div>
          <div className="form-field"><label htmlFor="city">Город <span>*</span></label><div className="input-with-icon"><MapPin size={17} /><input id="city" placeholder="Например, Екатеринбург" {...form.register("city")} data-testid="input-listing-city" /></div>{form.formState.errors.city && <small>{form.formState.errors.city.message}</small>}</div>
        </div>
        {createListing.isError && <div className="submit-error" role="alert">Не удалось опубликовать объявление. Проверьте данные и попробуйте ещё раз.</div>}
        <div className="form-submit-row"><span>Публикация бесплатна и занимает минуту.</span><button className="button-primary submit-button" type="submit" disabled={createListing.isPending} data-testid="button-submit-listing">{createListing.isPending ? <><LoaderCircle size={17} className="spin" /> Публикуем…</> : <>Опубликовать <ArrowRight size={17} /></>}</button></div>
      </form>
      <aside className="form-aside"><div className="aside-note"><span className="aside-icon"><Tag size={17} /></span><span className="eyebrow">НЕБОЛЬШОЙ СОВЕТ</span><h3>Хорошее объявление начинается с честности.</h3><p>Укажите реальное состояние вещи, понятную цену и удобный способ связи. Это помогает быстро договориться.</p><div className="aside-check"><Check size={15} /> Всё рядом, всё по делу</div></div><div className="aside-stamp">СОСЕДИ<br /><span>ВЫРУЧАЮТ</span></div></aside>
    </div>
  </PageContainer></SiteFrame>;
}
