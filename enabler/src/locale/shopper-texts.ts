/**
 * The strings the enabler's own chrome renders, per display locale.
 *
 * The table is keyed by {@link CheckoutLocale} and typed `Record<…>`, so a locale or key that is
 * missing fails the build rather than a review. Resolved ONCE per Enabler instance from the payment
 * config's locale — which is the session cart's, the authoritative display language — and
 * carried on `BaseOptions.texts`.
 *
 * Only text a SHOPPER reads lives here. A mount-target failure, an unsupported component type or an
 * unmapped method are diagnostics for whoever wired the enabler and stay English.
 *
 * English and Serbian are the two languages this repository can vouch for; the other 23 are
 * unreviewed.
 */
import { CheckoutLocale, resolveCheckoutLocale } from './checkout-locales';

export interface ShopperTexts {
  /** A payment that reached the processor or the vendor and failed. */
  paymentFailed: string;
  /** A payment that could not be started at all (no tokenization, no upgraded element). */
  paymentInitFailed: string;
  /** The mount itself failed, so the shopper has no secure form to type into. */
  formLoadFailed: string;
  /** The drop-in's whole content when the processor offered no method for this cart. */
  noPaymentMethods: string;
  /** A host asked this surface to pay while the vendor form still refuses to submit (a field missing or invalid). */
  paymentDetailsIncomplete: string;
  /** A host asked a wallet surface to pay; the sheet opens only from the vendor's own button. */
  useVendorButton: string;
}

export const SHOPPER_TEXTS: Record<CheckoutLocale, ShopperTexts> = {
  en: {
    paymentFailed: 'The payment could not be processed. Please try again.',
    paymentInitFailed: 'The payment could not be initialized. Please try again.',
    formLoadFailed: 'The secure payment form could not be loaded. Please try again.',
    noPaymentMethods: 'No payment methods are available for this order.',
    paymentDetailsIncomplete: 'Please complete your payment details before continuing.',
    useVendorButton: "Please use this payment method's own button to pay.",
  },
  'bg-BG': {
    paymentFailed: 'Плащането не можа да бъде обработено. Опитайте отново.',
    paymentInitFailed: 'Плащането не можа да бъде инициализирано. Опитайте отново.',
    formLoadFailed: 'Защитената форма за плащане не можа да бъде заредена. Опитайте отново.',
    noPaymentMethods: 'За тази поръчка няма налични начини на плащане.',
    paymentDetailsIncomplete: 'Моля, попълнете данните за плащане, преди да продължите.',
    useVendorButton: 'Моля, използвайте собствения бутон на този начин на плащане, за да платите.',
  },
  'cs-CZ': {
    paymentFailed: 'Platbu nebylo možné zpracovat. Zkuste to prosím znovu.',
    paymentInitFailed: 'Platbu nebylo možné inicializovat. Zkuste to prosím znovu.',
    formLoadFailed: 'Zabezpečený platební formulář se nepodařilo načíst. Zkuste to prosím znovu.',
    noPaymentMethods: 'Pro tuto objednávku nejsou k dispozici žádné platební metody.',
    paymentDetailsIncomplete: 'Před pokračováním prosím vyplňte platební údaje.',
    useVendorButton: 'K zaplacení použijte prosím vlastní tlačítko této platební metody.',
  },
  'da-DK': {
    paymentFailed: 'Betalingen kunne ikke gennemføres. Prøv igen.',
    paymentInitFailed: 'Betalingen kunne ikke initialiseres. Prøv igen.',
    formLoadFailed: 'Den sikre betalingsformular kunne ikke indlæses. Prøv igen.',
    noPaymentMethods: 'Der er ingen tilgængelige betalingsmetoder for denne ordre.',
    paymentDetailsIncomplete: 'Udfyld venligst dine betalingsoplysninger, før du fortsætter.',
    useVendorButton: 'Brug venligst betalingsmetodens egen knap for at betale.',
  },
  de: {
    paymentFailed: 'Die Zahlung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    paymentInitFailed: 'Die Zahlung konnte nicht initialisiert werden. Bitte versuchen Sie es erneut.',
    formLoadFailed: 'Das sichere Zahlungsformular konnte nicht geladen werden. Bitte versuchen Sie es erneut.',
    noPaymentMethods: 'Für diese Bestellung stehen keine Zahlungsarten zur Verfügung.',
    paymentDetailsIncomplete: 'Bitte vervollständigen Sie Ihre Zahlungsdaten, bevor Sie fortfahren.',
    useVendorButton: 'Bitte verwenden Sie die eigene Schaltfläche dieser Zahlungsart, um zu bezahlen.',
  },
  'el-GR': {
    paymentFailed: 'Η πληρωμή δεν μπόρεσε να ολοκληρωθεί. Δοκιμάστε ξανά.',
    paymentInitFailed: 'Η πληρωμή δεν μπόρεσε να αρχικοποιηθεί. Δοκιμάστε ξανά.',
    formLoadFailed: 'Η ασφαλής φόρμα πληρωμής δεν μπόρεσε να φορτωθεί. Δοκιμάστε ξανά.',
    noPaymentMethods: 'Δεν υπάρχουν διαθέσιμοι τρόποι πληρωμής για αυτή την παραγγελία.',
    paymentDetailsIncomplete: 'Συμπληρώστε τα στοιχεία πληρωμής πριν συνεχίσετε.',
    useVendorButton: 'Χρησιμοποιήστε το κουμπί της ίδιας της μεθόδου πληρωμής για να πληρώσετε.',
  },
  'en-US': {
    paymentFailed: 'The payment could not be processed. Please try again.',
    paymentInitFailed: 'The payment could not be initialized. Please try again.',
    formLoadFailed: 'The secure payment form could not be loaded. Please try again.',
    noPaymentMethods: 'No payment methods are available for this order.',
    paymentDetailsIncomplete: 'Please complete your payment details before continuing.',
    useVendorButton: "Please use this payment method's own button to pay.",
  },
  es: {
    paymentFailed: 'No se pudo procesar el pago. Vuelva a intentarlo.',
    paymentInitFailed: 'No se pudo inicializar el pago. Vuelva a intentarlo.',
    formLoadFailed: 'No se pudo cargar el formulario de pago seguro. Vuelva a intentarlo.',
    noPaymentMethods: 'No hay métodos de pago disponibles para este pedido.',
    paymentDetailsIncomplete: 'Complete los datos de pago antes de continuar.',
    useVendorButton: 'Utilice el botón propio de este método de pago para pagar.',
  },
  'et-EE': {
    paymentFailed: 'Makset ei õnnestunud töödelda. Palun proovige uuesti.',
    paymentInitFailed: 'Makset ei õnnestunud käivitada. Palun proovige uuesti.',
    formLoadFailed: 'Turvalist maksevormi ei õnnestunud laadida. Palun proovige uuesti.',
    noPaymentMethods: 'Selle tellimuse jaoks pole saadaval ühtegi makseviisi.',
    paymentDetailsIncomplete: 'Palun täitke makseandmed enne jätkamist.',
    useVendorButton: 'Maksmiseks kasutage palun selle makseviisi enda nuppu.',
  },
  'fi-FI': {
    paymentFailed: 'Maksua ei voitu käsitellä. Yritä uudelleen.',
    paymentInitFailed: 'Maksua ei voitu alustaa. Yritä uudelleen.',
    formLoadFailed: 'Suojattua maksulomaketta ei voitu ladata. Yritä uudelleen.',
    noPaymentMethods: 'Tälle tilaukselle ei ole saatavilla maksutapoja.',
    paymentDetailsIncomplete: 'Täytä maksutiedot ennen jatkamista.',
    useVendorButton: 'Käytä maksamiseen tämän maksutavan omaa painiketta.',
  },
  fr: {
    paymentFailed: "Le paiement n'a pas pu être traité. Veuillez réessayer.",
    paymentInitFailed: "Le paiement n'a pas pu être initialisé. Veuillez réessayer.",
    formLoadFailed: "Le formulaire de paiement sécurisé n'a pas pu être chargé. Veuillez réessayer.",
    noPaymentMethods: "Aucun moyen de paiement n'est disponible pour cette commande.",
    paymentDetailsIncomplete: 'Veuillez compléter vos informations de paiement avant de continuer.',
    useVendorButton: 'Veuillez utiliser le bouton propre à ce moyen de paiement pour payer.',
  },
  'hr-HR': {
    paymentFailed: 'Plaćanje nije bilo moguće obraditi. Pokušajte ponovno.',
    paymentInitFailed: 'Plaćanje nije bilo moguće pokrenuti. Pokušajte ponovno.',
    formLoadFailed: 'Sigurni obrazac za plaćanje nije bilo moguće učitati. Pokušajte ponovno.',
    noPaymentMethods: 'Za ovu narudžbu nije dostupan nijedan način plaćanja.',
    paymentDetailsIncomplete: 'Ispunite podatke o plaćanju prije nastavka.',
    useVendorButton: 'Za plaćanje koristite vlastiti gumb ovog načina plaćanja.',
  },
  hu: {
    paymentFailed: 'A fizetést nem sikerült feldolgozni. Kérjük, próbálja újra.',
    paymentInitFailed: 'A fizetést nem sikerült elindítani. Kérjük, próbálja újra.',
    formLoadFailed: 'A biztonságos fizetési űrlapot nem sikerült betölteni. Kérjük, próbálja újra.',
    noPaymentMethods: 'Ehhez a rendeléshez nem érhető el fizetési mód.',
    paymentDetailsIncomplete: 'Kérjük, a folytatás előtt töltse ki a fizetési adatokat.',
    useVendorButton: 'A fizetéshez kérjük, használja ennek a fizetési módnak a saját gombját.',
  },
  it: {
    paymentFailed: 'Non è stato possibile elaborare il pagamento. Riprova.',
    paymentInitFailed: 'Non è stato possibile inizializzare il pagamento. Riprova.',
    formLoadFailed: 'Non è stato possibile caricare il modulo di pagamento sicuro. Riprova.',
    noPaymentMethods: 'Nessun metodo di pagamento disponibile per questo ordine.',
    paymentDetailsIncomplete: 'Completa i dati di pagamento prima di continuare.',
    useVendorButton: 'Per pagare usa il pulsante di questo metodo di pagamento.',
  },
  'lt-LT': {
    paymentFailed: 'Mokėjimo nepavyko apdoroti. Bandykite dar kartą.',
    paymentInitFailed: 'Mokėjimo nepavyko inicijuoti. Bandykite dar kartą.',
    formLoadFailed: 'Saugios mokėjimo formos nepavyko įkelti. Bandykite dar kartą.',
    noPaymentMethods: 'Šiam užsakymui nėra galimų mokėjimo būdų.',
    paymentDetailsIncomplete: 'Prieš tęsdami užpildykite mokėjimo duomenis.',
    useVendorButton: 'Norėdami sumokėti, naudokite šio mokėjimo būdo mygtuką.',
  },
  'lv-LV': {
    paymentFailed: 'Maksājumu nevarēja apstrādāt. Lūdzu, mēģiniet vēlreiz.',
    paymentInitFailed: 'Maksājumu nevarēja inicializēt. Lūdzu, mēģiniet vēlreiz.',
    formLoadFailed: 'Drošo maksājuma veidlapu nevarēja ielādēt. Lūdzu, mēģiniet vēlreiz.',
    noPaymentMethods: 'Šim pasūtījumam nav pieejamu maksājumu veidu.',
    paymentDetailsIncomplete: 'Lūdzu, pirms turpināšanas aizpildiet maksājuma datus.',
    useVendorButton: 'Lai samaksātu, lūdzu, izmantojiet šī maksājuma veida pogu.',
  },
  'nb-NO': {
    paymentFailed: 'Betalingen kunne ikke behandles. Prøv igjen.',
    paymentInitFailed: 'Betalingen kunne ikke initialiseres. Prøv igjen.',
    formLoadFailed: 'Det sikre betalingsskjemaet kunne ikke lastes. Prøv igjen.',
    noPaymentMethods: 'Ingen betalingsmetoder er tilgjengelige for denne bestillingen.',
    paymentDetailsIncomplete: 'Fyll ut betalingsopplysningene før du fortsetter.',
    useVendorButton: 'Bruk betalingsmetodens egen knapp for å betale.',
  },
  'nl-NL': {
    paymentFailed: 'De betaling kon niet worden verwerkt. Probeer het opnieuw.',
    paymentInitFailed: 'De betaling kon niet worden geïnitialiseerd. Probeer het opnieuw.',
    formLoadFailed: 'Het beveiligde betaalformulier kon niet worden geladen. Probeer het opnieuw.',
    noPaymentMethods: 'Er zijn geen betaalmethoden beschikbaar voor deze bestelling.',
    paymentDetailsIncomplete: 'Vul uw betaalgegevens in voordat u verdergaat.',
    useVendorButton: 'Gebruik de eigen knop van deze betaalmethode om te betalen.',
  },
  'pl-PL': {
    paymentFailed: 'Nie udało się przetworzyć płatności. Spróbuj ponownie.',
    paymentInitFailed: 'Nie udało się zainicjować płatności. Spróbuj ponownie.',
    formLoadFailed: 'Nie udało się wczytać bezpiecznego formularza płatności. Spróbuj ponownie.',
    noPaymentMethods: 'Dla tego zamówienia nie są dostępne żadne metody płatności.',
    paymentDetailsIncomplete: 'Przed kontynuowaniem uzupełnij dane płatności.',
    useVendorButton: 'Aby zapłacić, użyj przycisku tej metody płatności.',
  },
  'pt-PT': {
    paymentFailed: 'Não foi possível processar o pagamento. Tente novamente.',
    paymentInitFailed: 'Não foi possível inicializar o pagamento. Tente novamente.',
    formLoadFailed: 'Não foi possível carregar o formulário de pagamento seguro. Tente novamente.',
    noPaymentMethods: 'Não há métodos de pagamento disponíveis para esta encomenda.',
    paymentDetailsIncomplete: 'Preencha os dados de pagamento antes de continuar.',
    useVendorButton: 'Utilize o botão próprio deste método de pagamento para pagar.',
  },
  'ro-RO': {
    paymentFailed: 'Plata nu a putut fi procesată. Încercați din nou.',
    paymentInitFailed: 'Plata nu a putut fi inițializată. Încercați din nou.',
    formLoadFailed: 'Formularul securizat de plată nu a putut fi încărcat. Încercați din nou.',
    noPaymentMethods: 'Nu există metode de plată disponibile pentru această comandă.',
    paymentDetailsIncomplete: 'Completați datele de plată înainte de a continua.',
    useVendorButton: 'Pentru a plăti, folosiți butonul propriu al acestei metode de plată.',
  },
  'sk-SK': {
    paymentFailed: 'Platbu sa nepodarilo spracovať. Skúste to znova.',
    paymentInitFailed: 'Platbu sa nepodarilo inicializovať. Skúste to znova.',
    formLoadFailed: 'Zabezpečený platobný formulár sa nepodarilo načítať. Skúste to znova.',
    noPaymentMethods: 'Pre túto objednávku nie sú k dispozícii žiadne spôsoby platby.',
    paymentDetailsIncomplete: 'Pred pokračovaním vyplňte platobné údaje.',
    useVendorButton: 'Na zaplatenie použite vlastné tlačidlo tejto platobnej metódy.',
  },
  'sl-SI': {
    paymentFailed: 'Plačila ni bilo mogoče obdelati. Poskusite znova.',
    paymentInitFailed: 'Plačila ni bilo mogoče inicializirati. Poskusite znova.',
    formLoadFailed: 'Varnega plačilnega obrazca ni bilo mogoče naložiti. Poskusite znova.',
    noPaymentMethods: 'Za to naročilo ni na voljo nobenega načina plačila.',
    paymentDetailsIncomplete: 'Pred nadaljevanjem izpolnite podatke o plačilu.',
    useVendorButton: 'Za plačilo uporabite lasten gumb tega načina plačila.',
  },
  'sr-RS': {
    paymentFailed: 'Plaćanje nije moglo da se obradi. Pokušajte ponovo.',
    paymentInitFailed: 'Plaćanje nije moglo da se pokrene. Pokušajte ponovo.',
    formLoadFailed: 'Bezbedna forma za plaćanje nije mogla da se učita. Pokušajte ponovo.',
    noPaymentMethods: 'Za ovu porudžbinu nije dostupan nijedan način plaćanja.',
    paymentDetailsIncomplete: 'Popunite podatke o plaćanju pre nego što nastavite.',
    useVendorButton: 'Za ovaj način plaćanja koristite njegovo sopstveno dugme za plaćanje.',
  },
  'sv-SE': {
    paymentFailed: 'Betalningen kunde inte genomföras. Försök igen.',
    paymentInitFailed: 'Betalningen kunde inte initieras. Försök igen.',
    formLoadFailed: 'Det säkra betalningsformuläret kunde inte laddas. Försök igen.',
    noPaymentMethods: 'Inga betalningsmetoder är tillgängliga för den här beställningen.',
    paymentDetailsIncomplete: 'Fyll i dina betalningsuppgifter innan du fortsätter.',
    useVendorButton: 'Använd betalningsmetodens egen knapp för att betala.',
  },
};

/** The texts for a requested locale, through {@link resolveCheckoutLocale}. */
export function resolveShopperTexts(requested?: string): ShopperTexts {
  return SHOPPER_TEXTS[resolveCheckoutLocale(requested)];
}
