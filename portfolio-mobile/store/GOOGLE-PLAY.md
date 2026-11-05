# Fincake — príprava Google Play

Stav kontroly: 4. 11. 2026. **Pripravené podklady, nie schválené vydanie.**
Žiadny AAB zatiaľ nebol podpísaný ani nahraný. Pravidlá a formuláre treba
pred odoslaním znovu skontrolovať. Tento dokument nenahrádza právne posúdenie.

## 1. Čo už je pripravené

- Nový Android identifikátor `com.fincake.app`, verzia `4.0.0`.
- Android cieli na API 36 (Android 16), aktuálne minimum pre nové aplikácie a
  aktualizácie od 31. 8. 2026.
- Produkčný EAS profil: Android App Bundle, store distribúcia, automatický versionCode.
- Bez reklám, reklamného SDK, nákupov a predplatného v tomto vydaní.
- Profil → **Súkromie a podpora**, dostupné aj bez prihlásenia.
- Lokálne portfólio, CSV import/export a voliteľný lokálny AES-GCM šifrovaný prenos
  cez súbor a samostatný obnovovací kód; aplikácia nemá registráciu ani cloudové zálohy.
- Predvolený Watchlist je prázdny, bez ukážkových akcií. Existujúce uložené
  zoznamy zostávajú nezmenené.
- Udalosti → filter: predvolene všetky otvorené pozície, prípadne vlastný výber
  jednotlivých akcií z portfólia a všetkých watchlistov. Výber sa ukladá lokálne
  a prenáša v šifrovanej zálohe; staršie zálohy použijú predvolený režim.
  Panel má zbalené sekcie Portfólio a Watchlist s výberom celej skupiny.
  Šípka rozbalí jednotlivé akcie; pomlčka označuje čiastočný výber.
- Editácia alebo pridanie transakcie z „Moje pohyby“ sa po uložení či zatvorení
  formulára vracia do histórie pohybov, nie na detail akcie.
  História zostáva otvorená aj pod priehľadným editorom počas úprav.
  Buy, Sell a tlačidlo počtu akcií majú jemnú haptickú odozvu.
- Podržanie stĺpca v dividendovom kalendári zobrazí mesiac a sumu výplat v EUR.
  Pri skrytí súm zostáva hodnota skrytá aj v tomto zobrazení.
- Vyhladený model výhľadu sa pripravuje po načítaní transakcií pri otvorení
  Forecastu; otvorenie nastavení ani prepnutie modelu výpočet neopakujú.
- Informačné upozornenie: Nákup/Predaj len evidujú, nevykonávajú obchody;
  prognózy nie sú zárukou zisku ani personalizovaným odporúčaním.
- Odstránené nepotrebné Android oprávnenia: kamera, mikrofón, kontakty,
  poloha, široký prístup k úložisku/médiám, overlay a reklamné ID.
  Potrebný ostáva internet a vibrácie. CSV používa systémový výber súboru.
- Vypnuté Android systémové zálohovanie dát; pri odinštalovaní sa lokálne dáta stratia,
  ak si používateľ vopred neuložil šifrovanú zálohu aj obnovovací kód.
- SK/EN texty v [listing.json](listing.json), spoločný obsah zásad a webu
  v [privacy-content.json](privacy-content.json).

**Zmena balíka:** GitHub APK s pôvodným `com.anonymous.portfoliomobile`
sa neaktualizuje novým balíkom. Bude to druhá aplikácia. Pred prechodom exportuj CSV;
nový šifrovaný formát nie je dostupný v starej aplikácii, takže nastavenia a zoznamy
sledovaných sa automaticky neprevezmú.
Toto platí aj pre ďalšie APK z existujúceho GitHub workflow.
Pred prvým uploadom skontroluj, či v Play Console nie je rozpracovaná aplikácia
s iným balíkom. Názov balíka po publikovaní nemožno zmeniť.

## 2. Blokátory, ktoré musí doplniť prevádzkovateľ

1. **Play Console:** vývojársky profil nie je to isté ako vytvorená aplikácia.
   Otvor Console → Create app → Fincake → App → Free → Finance.
   Skontroluj overenie identity, zariadenia, kontakty a trader status.
   Povinné osobné/organizačné údaje zadávaj priamo do Console, nie do Git repozitára.
2. **Typ účtu:** Google vyžaduje organizačný účet pri poskytovaní finančných
   produktov/služieb. Fincake je len evidencia a výpočty, nie broker, ale zahŕňa
   správu portfólia. Pred produkciou potvrď s podporou Play, či súčasný typ účtu
   pre tento rozsah postačuje. Neobchádzaj to deklaráciou „žiadne finančné funkcie“.
3. **Verejný prevádzkovateľ a funkčný support e-mail.** The app and listing use
   `support@fincake.eu`. Over, že schránka prijíma správy; potvrdzovacie a resetovacie
   e-maily sa nepoužívajú.
4. **HTTPS web** pre privacy policy a žiadosti o ochranu údajov.
   Stránky nesmú byť za prihlásením, geoblokom, v PDF ani vyžadovať editovateľný dokument.
   Musia jasne uvádzať Fincake/prevádzkovateľa a kontaktný spôsob vybavenia.
   Kontrola 4. 11. 2026: obe GitHub Pages URL vracajú HTTP 200 cez HTTPS
   s platným certifikátom; v ceste použi veľké `Cake`.
5. **Externí poskytovatelia:** over ich podmienky, spracúvanie, prenosy mimo EHP
   a uchovávanie požiadavkových/prevádzkových záznamov. Fincake neprevádzkuje
   vlastné serverové zaznamenávanie požiadaviek ani analytiku; externí poskytovatelia
   majú vlastné, rozdielne lehoty, ktoré Fincake neurčuje. Portfólio sa neukladá v cloude.
6. **Práva k dátam:** `dataProviderRightsConfirmed` zostáva `false`. FMP výslovne
   vyžaduje samostatnú Data Display and Licensing Agreement na verejné zobrazovanie
   alebo redistribúciu. Aplikácia volá Yahoo Finance endpointy priamo; v kóde nie je
   Yahoo-issued API credential ani licencia. Logá FMP/Parqet sa načítavajú z ich CDN
   bez doloženej licencie. Verejný endpoint ani neplatená aplikácia práva nedokazujú.
   Získaj písomné povolenia alebo odstráň/zmeň dotknuté zdroje pred vydaním.
   Privátny API kľúč sa nesmie zabaliť ako `EXPO_PUBLIC_*`; do klienta len
   poskytovateľom výslovne povolené verejné hodnoty.
7. **Expo účet/projekt, produkčný podpis a AAB.** Expo projekt už je prepojený;
   produkčný AAB ešte treba zostaviť a overiť.
8. **Skutočné screenshoty** zo zostavy a pre-launch/device testy; nikdy vlastné súkromné portfólio.

## 3. Kontakty a verejné stránky

Vyplň [public-details.json](public-details.json). Obsahuje iba údaje určené
na zverejnenie, nie heslá, adresu bydliska, signing kľúče ani tokeny.

- `operatorName`: overený verejný názov prevádzkovateľa, konzistentný s listingom.
- `supportEmail`: fungujúca, pravidelne kontrolovaná schránka pre podporu a otázky k údajom.
- `privacyUrl`, `deletionUrl`: reálne verejné HTTPS adresy stránok.
- `hostingRegion`: potvrdenie, že portfólio je lokálne, a online poskytovatelia.
- `backupRetention`, `logRetention`: overené pravidlá lokálneho uchovávania a poskytovateľov.
- `policyReviewedOn`: dátum skutočnej kontroly zásad, `YYYY-MM-DD`.
- `dataProviderRightsConfirmed`: nastav na `true` až po overení práv.

Aplikácia nevytvára používateľské účty. Povinnosť ponúknuť zmazanie účtu v aplikácii
a na webe sa týka aplikácií, ktoré umožňujú vytvorenie účtu; Fincake preto nesľubuje
lehotu na zmazanie účtu. Samostatná stránka vysvetľuje vymazanie lokálnych dát
a kontaktovanie podpory v súvislosti so záznamami zo starších testovacích verzií.

`support@fincake.eu` is an inbound support address. Supabase SMTP is no longer
used by the app; do not configure authentication secrets in EAS or builds.

Z adresára aplikácie:

```powershell
npm run store:pages:draft
# Po doplnení údajov a právnej/prevádzkovej kontrole:
npm run store:pages
```

Vzniknú samostatné dvojjazyčné HTML súbory v `store/generated/`:
`privacy.html` a `delete-account.html`. Verejná verzia sa automaticky nasadzuje
cez GitHub Pages na `https://andrejmacko12345-spec.github.io/Cake/privacy.html`
a `https://andrejmacko12345-spec.github.io/Cake/delete-account.html`.
Návrhový režim zreteľne označuje DRAFT a nesmie sa zverejniť.
Finálne stránky ani aplikácia nesmú uvádzať nedoplnené údaje.
Po každej zmene skontroluj zásady aj listing a prestavaj aplikáciu.

Webová stránka vysvetľuje vymazanie lokálnych dát cez nastavenia zariadenia a
kontaktovanie podpory pre otázky o údajoch poskytovateľov. Aplikácia nevytvára účty
ani neukladá portfóliá na serveri; exportované súbory a dáta iných aplikácií
nevie vymazať.

## 4. Listing na skopírovanie

[listing.json](listing.json) obsahuje samostatné `sk-SK` a `en-US` verzie:

- Názov: **Fincake** (limit 30 znakov).
- Krátky popis: limit 80 znakov.
- Plný popis: limit 4 000 znakov.
- Release notes: limit 500 znakov.
- Kategória návrhu: **Finance**, typ **App**, cena **Free**, **No ads**.
- Podporný e-mail: doplniť; privacy URL: doplniť.
- Tagy vyber iba z relevantných dostupných možností Console.
- Nepoužívať tvrdenia o garantovanom zisku, kompletnom pokrytí trhu,
  presnosti alebo real-time dátach. Žiadne „najlepší“, rankingy ani falošné recenzie.

## 5. Data safety — návrh podľa aktuálneho kódu

**Nezaškrtávať automaticky „žiadne údaje sa nezhromažďujú“.** Portfólio a
transakcie zostávajú v zariadení, ale online dopyty môžu poskytovateľom odovzdať
IP adresu, technické údaje a vyhľadávaný symbol/text. Skontroluj výsledný AAB,
SDK a skutočné požiadavky pred vyplnením formulára.

| Kategória | Reálny tok | Povinnosť / účel | Čo potvrdiť v Console |
|---|---|---|---|
| Financial info → Other financial info; posúdiť aj Purchase history | Transakcie: symboly, množstvá, nákupné/predajné ceny a dátumy | Zostávajú v zariadení; app functionality | Potvrdiť podľa aktuálneho formulára a reálneho SDK toku; neoznačovať ako cloud collection bez dôkazu |
| App activity → Other user-generated content | Watchlisty a nastavenia zostávajú v zariadení | App functionality | Potvrdiť, či lokálne spracovanie bez zdieľania spadá do konkrétnej definície |
| App activity → In-app search history | Vyhľadávaný text odchádza priamo do Yahoo search | Online vyhľadávanie; app functionality | Posúdiť zber/zdieľanie, uchovávanie a ephemerálnosť poskytovateľa; nie automaticky „nezbiera sa“ |
| Device or other IDs / Diagnostics / prípadne approximate location | IP, HTTP hlavičky, auth a serverové logy u poskytovateľov | Online funkcie a bezpečnosť | IP nie je automaticky deklarácia GPS; kategóriu a účel urči podľa reálneho použitia a SDK/hostingu |

Yahoo, FMP, Parqet, SEC a GitHub sú priame externé služby. Bez kontroly ich
podmienok, logovania a skutočných tokov nemožno sľúbiť „žiadne zdieľanie“.
Ani ephemerálne spracúvanie nie je automatická výnimka z vyplnenia formulára.
CSV import spracúva súbor lokálne; export je používateľom iniciovaný prenos.
Export do inej služby je používateľom iniciovaný prenos — posúď príslušnú výnimku.

- Prenos implementovaných online požiadaviek: HTTPS. Over aj výsledný AAB a redirecty.
- Účet ani prihlásenie nie sú súčasťou aplikácie.
- Portfólio je lokálne; externí poskytovatelia môžu zaznamenávať sieťové požiadavky.
- Neoznačovať nezávislý bezpečnostný audit/certifikáciu; nebol vykonaný.
- Nie sú implementované reklamné/behaviorálne analytické SDK. Over finálny dependency/manifest report.

## 6. Ostatné deklarácie v Console

- **Financial features:** vybrať relevantné **Stock trading and portfolio management**;
  do vysvetlenia uviesť „portfolio tracking only; no order execution, custody,
  broker connectivity, loans, payments or personalized financial advice“.
  Skontrolovať aktuálne možnosti a prípadné požadované dokumenty, najmä typ účtu.
- **Ads:** No pre túto zostavu.
- **App access:** účet nie je potrebný; reviewer používa lokálne funkcie bez prihlasovania.
- **Target audience:** návrh dospelí 18+; túto voľbu musí potvrdiť prevádzkovateľ
  podľa reálneho zamýšľaného publika. Nie je to automatické vekové hodnotenie.
- **Content rating/IARC:** vyplniť pravdivo; rating prideľuje dotazník.
  Bez chatu, používateľského publikovania, hazardu a skutočného obchodovania.
  Existujú externé finančné správy/odkazy; uviesť ich podľa otázok formulára.
- **Health / government / news:** nevydávať sa za zdravotnú, vládnu ani spravodajskú
  organizáciu. Finančné správy sú sprievodná funkcia; prípadnú požadovanú news
  deklaráciu vyplniť podľa dostupných otázok, nie automaticky ignorovať.
- Overiť export compliance, krajiny distribúcie, práva k značke a kontentové dotazníky.
- Pri neskorších platených digitálnych funkciách treba znovu posúdiť Google Play
  Billing a príslušné regionálne pravidlá; aktuálna verzia nič také nemá.

## 7. Podpis, build a nahratie

```powershell
Set-Location portfolio-mobile
npx eas-cli@latest login
npx eas-cli@latest init
# Doplniť public-details.json a overiť stránky, kontakty a licencie.
npm run store:check
npm run build:android:store
```

`store:check` kontroluje miestne podklady a zámerne zlyhá pri chýbajúcich údajoch.
Nekontroluje právny súhlas, dostupnosť verejných stránok, schválenie účtu
ani reálne fungovanie aplikácie. Pred uploadom všetko over manuálne.
EAS má samostatné production prostredie; premenné GitHub Actions doň neprechádzajú.
Pre generovanie AAB treba Expo prístup a upload signing key.
Nezdieľať keystore/heslá v repozitári. Povoľ **Play App Signing**, bezpečne eviduj
upload certifikát a prístupy. Starý APK workflow nepoužívať ako dôkaz produkčného podpisu.

Prvé nahratie AAB vykonať ručne v Play Console → Internal testing.
Nevytvárať automatický produkčný rollout ani service-account kľúč, kým neexistuje
aplikácia a nie sú potvrdené oprávnenia. Každý ďalší AAB musí mať vyšší versionCode;
pri striedaní GitHub/EAS buildov koordinovať číslovanie.

### Povinné technické overenie výsledného AAB

- Podľa aktuálneho pravidla nové aplikácie a aktualizácie od 31. 8. 2026 cielia
  **Android 16 / API 36 alebo vyššie**. Over skutočný target SDK v AAB/Console;
  verzia Expo sama osebe nie je dôkaz.
- Over kompatibilitu všetkých natívnych knižníc so **16 KB memory pages** a 64-bit ABI.
  RN/Expo knižnice treba posúdiť z konkrétneho AAB a testovať na 16 KB zariadení/emulátore.
- Over zlúčený release manifest: iba potrebné oprávnenia, žiadny cleartext traffic,
  debug/release nastavenia a žiadny testovací podpis.
- Test API 36, minimum SDK výslednej zostavy, malé displeje, font scaling,
  gesture/navigation bar, keyboard, offline a slabá sieť.
- CSV a šifrovaný prenos na Android a web; nesprávny kód, poškodený súbor,
  výmena dát a opätovné spustenie po obnove; haptika bez pádu;
  lokálne dáta po reštarte aplikácie a po aktualizácii.
- Nespúšťať deklaráciu „splnené“ iba na základe JS exportu.

## 8. Grafické podklady

- Ikona Play: PNG RGBA, **512 × 512**, max. **1 024 KB**.
  Pripravená z existujúcej ikony: [assets/play-icon.png](assets/play-icon.png).
  Pred publikovaním vizuálne skontrolovať branding, nie použiť cudzie firemné logo.
- Feature graphic: JPEG alebo 24-bit PNG bez alpha, **1 024 × 500**.
  Pripravené návrhy [SK](assets/feature-graphic-sk.png)
  a [EN](assets/feature-graphic-en.png), s existujúcim brandingom Fincake.
- Tmavé alternatívy: [zelená](assets/dark/green) ladí s novými screenshotmi,
  [oranžová](assets/dark/orange) zachováva pôvodný akcent značky.
  Každá obsahuje ikonu 512 × 512 a grafiku 1 024 × 500 v SK aj EN;
  [spoločný náhľad](assets/dark/preview.png) a
  [ZIP](assets/dark/fincake-dark-branding.zip). Pôvodné podklady zostávajú
  zachované; **zelená tmavá ikona je nastavená pre nové buildy aplikácie**.
  `assets/icon-green.png` je 1 024 × 1 024 pre základnú/iOS ikonu a web;
  Android používa samostatné transparentné popredie, tmavé pozadie
  a monochromatickú vrstvu pre tematické ikony.
  Zmena sa prejaví po zostavení a nainštalovaní nového APK/AAB, nie cez OTA aktualizáciu.
- Telefón: minimálne **2 skutočné screenshoty**, odporúčam 6–8;
  PNG/JPEG, každá strana 320–3 840 px, dlhšia najviac 2× kratšia.
  Na propagačné plochy odporúčané aspoň 4 screenshoty s rozlíšením min. 1 080 px.
- Pripravené poradie: portfólio → udalosti → sledované → projekcie → porovnanie → výhľad.
- Samostatné SK/EN obrázky pri lokalizovanom UI; konzistentný vzhľad a aktuálna zostava.
- Použiť výhradne syntetické/demo transakcie, nie osobné portfólio, e-mail alebo účty.
- Bez falošných UI prvkov, sľubov zisku, hodnotení a odznakov Google Play.
- Žiadne obrázky v tomto balíku nepredstavujú hotové screenshoty testovanej AAB zostavy.

### Lokalizované propagačné náhľady

V [assets/screenshots/sk-SK](assets/screenshots/sk-SK) a
[assets/screenshots/en-US](assets/screenshots/en-US) je po šesť PNG obrázkov
**1080 × 1920**. Prehľad celej série:
[SK](assets/screenshots/preview-sk-SK.png) a
[EN](assets/screenshots/preview-en-US.png).
Do telefónnych screenshotov v príslušnom jazyku vyber iba šesť obrázkov
z daného jazykového priečinka, nie prehľadové koláže. Poradie určujú číselné
prefixy názvov súborov; samotné vizualizácie nemajú viditeľné číslovanie.

Obrázky používajú skutočné aktuálne rozhranie Expo web pri mobilnej veľkosti,
nie AI vygenerované UI ani screenshot otestovaného Android AAB.
Pred publikovaním porovnaj obsah s finálnou Android zostavou.
Ukážkové množstvá AAPL, MSFT, NVDA, AMZN, GOOG a KO sú fiktívne.
Nákupné ceny k 6. 1. 2025, kurzy USD/EUR a aktuálne kotácie sú reálne dáta
Yahoo Finance. Výsledky firiem zobrazuje existujúca dátová vrstva aplikácie.
Projekcia MSFT používa výslovne modelové vstupy: rast tržieb 10 %,
rast zisku 12 % a P/E 24–34; nejde o analytickú predpoveď.
Pôvodné zábery sú v `raw`, demo dáta v `demo-portfolio.json`;
čas vytvorenia a verejné zdroje sú v `manifest.json`.
Osobné portfólio ani nastavenia používateľa sa nemenia.

Obnovenie obrázkov cez Microsoft Edge na Windows (dva terminály v projekte):

```powershell
# Terminál 1
npm run web -- --port 8081

# Terminál 2; nástroje iba v dočasnom priečinku, bez zmeny závislostí aplikácie
npm install --prefix "$env:TEMP\fincake-capture-tools" --no-package-lock --no-audit --no-fund playwright
$env:CAPTURE_PLAYWRIGHT = "$env:TEMP\fincake-capture-tools\node_modules\playwright"
node scripts\capture-store-screenshots.cjs
node --test scripts\capture-store-screenshots.test.cjs
```

Ak už existuje kompletná sada, možno obnoviť iba vybrané obrazovky bez zmeny
ostatných obrázkov a demo portfólia:

```powershell
$env:CAPTURE_FEATURES = 'projections,compare'
node scripts\capture-store-screenshots.cjs
Remove-Item Env:\CAPTURE_FEATURES
```

Po obnovení obrázkov znovu vytvor ZIP s oboma jazykmi:

```powershell
Compress-Archive -Path 'store\assets\screenshots\sk-SK','store\assets\screenshots\en-US' -DestinationPath 'store\assets\screenshots\fincake-play-screenshots.zip' -Force
```

Capture vytvára izolovaný prehliadač s demo úložiskom. Len v zachytenom
webovom bundle odstráni tri kontroly blokujúce webové kotácie a verejné Yahoo
požiadavky odošle cez HTTP klienta Playwright, aby obišiel CORS.
Produkčné zdroje ani natívne správanie nemení. Pri zmene týchto kontrol
skript skončí chybou; dáta nenahrádza vymyslenými hodnotami.

Tmavé grafiky možno znovu vytvoriť po nastavení `CAPTURE_PLAYWRIGHT`
rovnakým postupom ako pri screenshotoch. Skript obnoví aj zelené buildové
ikony v `assets`; pôvodný `assets/icon.png` zostáva zdrojom geometrie loga:

```powershell
node scripts\create-dark-play-graphics.cjs
node --test scripts\create-dark-play-graphics.test.cjs
Compress-Archive -Path 'store\assets\dark\green','store\assets\dark\orange' -DestinationPath 'store\assets\dark\fincake-dark-branding.zip' -Force
```

## 9. Pred povolením produkcie

- [ ] Overený účet a jeho vhodný typ; aplikácia vytvorená so správnym package.
- [ ] Funkčné privacy/data-request URL a support; právne a retenčné údaje potvrdené.
- [ ] Staršie testovacie záznamy v Supabase doriešené so súhlasom vlastníka
  dát alebo transparentne ošetrené retenčnými pravidlami a zásadami ochrany súkromia.
- [ ] Práva k zdrojom dát/logám a pravidlá externých poskytovateľov potvrdené.
- [ ] Podpísané AAB, API/16 KB/permissions skontrolované, Play pre-launch report bez blokátorov.
- [ ] Lokálne transakcie a nastavenia prežijú reštart a aktualizáciu aplikácie.
- [ ] CSV import/export, šifrovaná obnova a strata dát po vymazaní aplikácie
  sú otestované a zdokumentované.
- [ ] Listing, screenshoty, rating, Data safety, financial features a app access doplnené.
- [ ] Ak ide o osobný účet vytvorený po 13. 11. 2023: najmenej **12 testerov**
  zapojených nepretržite **14 dní** do closed testu a následná žiadosť o production access.
  Interný test túto podmienku nenahrádza; schválenie nie je automatické.
- [ ] Až potom výslovné rozhodnutie prevádzkovateľa o krajinách a rolloute.

## Oficiálne zdroje

- [Vytvorenie aplikácie, AAB, permanentný package a podpis](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [User Data a privacy policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Vymazanie účtu vrátane webovej/e-mailovej cesty](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Data safety — kategórie a výnimky](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Financial features](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en)
- [Typ vývojárskeho účtu](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en)
- [Identita a kontakty vývojára](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)
- [Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Target API](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [16 KB memory pages](https://developer.android.com/guide/practices/page-sizes)
- [Grafika a screenshoty](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
- [Expo store build](https://docs.expo.dev/build/setup/)
