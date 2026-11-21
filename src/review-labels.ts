import { currentLanguage } from './appearance.ts';

const en = {
  heading: 'What our guests say.', previous: 'Previous review', next: 'Next review', featured: 'Featured',
  fullImage: 'View full review image', readSource: 'Read source', loading: 'Loading guest reviews…',
  empty: 'Stayed with us? Share your Moon Crab story.', google: 'Leave a review on Google', unavailable: 'Guest reviews are temporarily unavailable.',
  admin: 'Guest Reviews', add: 'Add Review', edit: 'Edit', search: 'Search reviews', status: 'Status', all: 'All', source: 'Source',
  name: 'Guest display name', text: 'Review text', date: 'Review date', rating: 'Rating (optional)', scale: 'Rating scale',
  sourceLink: 'Public source link', sourceName: 'Other source name', notes: 'Private notes', photo: 'Review image', choose: 'Browse images', alt: 'Image description',
  cropX: 'Thumbnail horizontal position', cropY: 'Thumbnail vertical position', preview: 'Preview', publish: 'Publish Review',
  draft: 'Save draft', save: 'Save changes', close: 'Close', hide: 'Unpublish', archive: 'Archive', restore: 'Restore to draft',
  up: 'Move earlier', down: 'Move later', removeImage: 'Remove image', original: 'Open original',
  redact: 'Redact private details', undo: 'Undo redaction', noResults: 'No matching reviews.',
  approved: 'I have permission to publish this genuine review and any photo. I’ve checked the complete public image and removed private details.',
  Draft: 'Draft', Published: 'Published', Hidden: 'Hidden', Archived: 'Archived',
} as const;
export type ReviewLabel = keyof typeof en;

const translations: Record<string, Partial<Record<ReviewLabel, string>>> = {
  fil: {
    heading:'Sabi ng aming mga bisita', previous:'Nakaraang review', next:'Susunod na review', featured:'Itinatampok',
    fullImage:'Tingnan ang buong larawan ng review', readSource:'Basahin ang pinagmulan', loading:'Naglo-load ang mga review…',
    empty:'Nakapag-stay ka na sa amin? Ibahagi ang iyong kuwento.', google:'Mag-iwan ng review sa Google', unavailable:'Pansamantalang hindi makita ang mga review.',
    admin:'Mga Review ng Bisita', add:'Magdagdag ng Review', edit:'I-edit', search:'Maghanap ng review', status:'Katayuan', all:'Lahat', source:'Pinagmulan',
    name:'Pangalang ipapakita', text:'Teksto ng review', date:'Petsa ng review', rating:'Rating (opsyonal)', scale:'Iskala ng rating',
    sourceLink:'Pampublikong link ng pinagmulan', sourceName:'Ibang pinagmulan', notes:'Pribadong tala', photo:'Larawan ng review', choose:'Pumili ng larawan', alt:'Paglalarawan ng larawan',
    cropX:'Pahalang na posisyon ng thumbnail', cropY:'Patayong posisyon ng thumbnail', preview:'Silipin', publish:'I-publish ang Review',
    draft:'I-save ang draft', save:'I-save ang mga pagbabago', close:'Isara', hide:'Itago sa website', archive:'I-archive', restore:'Ibalik bilang draft',
    up:'Ilipat pataas', down:'Ilipat pababa', removeImage:'Alisin ang larawan', original:'Buksan ang orihinal', redact:'Takpan ang pribadong detalye', undo:'Ibalik ang tinakpan', noResults:'Walang tugmang review.',
    approved:'May pahintulot akong i-publish ang tunay na review at anumang larawan. Nasuri ko ang buong pampublikong larawan at inalis ang pribadong impormasyon.',
    Draft:'Burador', Published:'Nai-publish', Hidden:'Nakatago', Archived:'Naka-archive',
  },
  ceb: { heading:'Ang giingon sa among mga bisita', previous:'Miaging review', next:'Sunod nga review', featured:'Gipasiugda',
    fullImage:'Tan-awa ang tibuok hulagway', readSource:'Basaha ang tinubdan', loading:'Nag-load sa mga review…',
    empty:'Nakapuyo ka na dinhi? Ipaambit ang imong sugilanon.', google:'Pagsulat og review sa Google', unavailable:'Dili pa makita ang mga review.',
    admin:'Mga Review sa Bisita', add:'Pagdugang og review', search:'Pangitaa ang mga review', preview:'Tan-awa daan', publish:'Imantala ang review', close:'Sirad-i' },
  es: { heading:'Lo que dicen nuestros huéspedes', previous:'Reseña anterior', next:'Siguiente reseña', featured:'Destacada',
    fullImage:'Ver imagen completa', readSource:'Leer la fuente', loading:'Cargando reseñas…', empty:'¿Te alojaste aquí? Cuéntanos tu experiencia.',
    google:'Deja una reseña en Google', unavailable:'Las reseñas no están disponibles por el momento.',
    admin:'Reseñas de huéspedes', add:'Añadir reseña', search:'Buscar reseñas', preview:'Vista previa', publish:'Publicar reseña', close:'Cerrar' },
  fr: { heading:'L’avis de nos hôtes', previous:'Avis précédent', next:'Avis suivant', featured:'À la une', fullImage:'Voir l’image complète',
    readSource:'Lire la source', loading:'Chargement des avis…', empty:'Vous avez séjourné chez nous ? Racontez-nous votre expérience.',
    google:'Laisser un avis sur Google', unavailable:'Les avis sont momentanément indisponibles.', admin:'Avis des hôtes', add:'Ajouter un avis', preview:'Aperçu', publish:'Publier l’avis', close:'Fermer' },
  de: { heading:'Das sagen unsere Gäste', previous:'Vorherige Bewertung', next:'Nächste Bewertung', featured:'Hervorgehoben', fullImage:'Ganzes Bild anzeigen', readSource:'Quelle lesen', google:'Bei Google bewerten' },
  it: { heading:'Cosa dicono i nostri ospiti', previous:'Recensione precedente', next:'Recensione successiva', featured:'In evidenza', fullImage:'Mostra immagine completa', readSource:'Leggi la fonte' },
  pt: { heading:'O que dizem os nossos hóspedes', previous:'Avaliação anterior', next:'Próxima avaliação', featured:'Em destaque', fullImage:'Ver imagem completa', readSource:'Ler a fonte' },
  nl: { heading:'Wat onze gasten zeggen', previous:'Vorige review', next:'Volgende review', featured:'Uitgelicht', fullImage:'Bekijk de volledige afbeelding', readSource:'Lees de bron' },
  ja: { heading:'お客様の声', previous:'前のレビュー', next:'次のレビュー', featured:'注目のレビュー', fullImage:'画像全体を見る', readSource:'掲載元で読む' },
  ko: { heading:'투숙객 후기', previous:'이전 후기', next:'다음 후기', featured:'추천 후기', fullImage:'전체 이미지 보기', readSource:'원문 보기' },
  'zh-Hans': { heading:'住客评价', previous:'上一条评价', next:'下一条评价', featured:'精选', fullImage:'查看完整图片', readSource:'查看来源' },
  'zh-Hant': { heading:'住客評價', previous:'上一則評價', next:'下一則評價', featured:'精選', fullImage:'查看完整圖片', readSource:'查看來源' },
  id: { heading:'Kata para tamu kami', previous:'Ulasan sebelumnya', next:'Ulasan berikutnya', featured:'Pilihan', fullImage:'Lihat gambar lengkap', readSource:'Baca sumber' },
  ms: { heading:'Kata tetamu kami', previous:'Ulasan sebelumnya', next:'Ulasan seterusnya', featured:'Pilihan', fullImage:'Lihat imej penuh', readSource:'Baca sumber' },
  th: { heading:'เสียงจากผู้เข้าพัก', previous:'รีวิวก่อนหน้า', next:'รีวิวถัดไป', featured:'รีวิวแนะนำ', fullImage:'ดูภาพเต็ม', readSource:'อ่านจากแหล่งที่มา' },
  vi: { heading:'Khách lưu trú nói gì', previous:'Đánh giá trước', next:'Đánh giá tiếp theo', featured:'Nổi bật', fullImage:'Xem ảnh đầy đủ', readSource:'Đọc tại nguồn' },
  ru: { heading:'Отзывы наших гостей', previous:'Предыдущий отзыв', next:'Следующий отзыв', featured:'Избранный отзыв', fullImage:'Открыть полное изображение', readSource:'Читать в источнике' },
  ar: { heading:'آراء ضيوفنا', previous:'التقييم السابق', next:'التقييم التالي', featured:'مميّز', fullImage:'عرض الصورة كاملة', readSource:'اقرأ في المصدر' },
  hi: { heading:'हमारे मेहमानों की राय', previous:'पिछली समीक्षा', next:'अगली समीक्षा', featured:'चुनिंदा', fullImage:'पूरी तस्वीर देखें', readSource:'स्रोत पर पढ़ें' },
};
export const reviewLabel = (key: ReviewLabel) => translations[currentLanguage()]?.[key] ?? en[key];
export const reviewLabelMarkup = (key: ReviewLabel) => `<span data-review-label="${key}">${reviewLabel(key)}</span>`;

export function translateReviewLabels(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-review-label]').forEach(node => {
    node.textContent = reviewLabel(node.dataset.reviewLabel as ReviewLabel);
  });
}
