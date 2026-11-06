# Projektovi agenti

V novom chate vyber agenta zo zoznamu agentov vo VS Code.
Ak sa nezobrazi, obnov okno VS Code a skontroluj nacitanie projektovych agentov.
Definicie su projektove, verzovane v Gite; nemenia osobne nastavenia modelov.

| Agent | Kedy ho pouzit |
| --- | --- |
| [App Design](design.agent.md) | Dizajn, obrazovky, UX, stylovanie a pristupnost |
| [Bug Fix](bugfix.agent.md) | Reprodukcia chyby, oprava priciny a regresny test |
| [Build and Test](build-test.agent.md) | Testy, typecheck, diagnostika a overenie APK/AAB buildu |
| [GitHub APK](github-release.agent.md) | Existujuci Actions workflow, APK a GitHub Releases |
| [Google Play](google-play.agent.md) | AAB, testovacie tracky, vydania a upravy Play Console |

## Skills nacitavane podla ulohy

| Agent | Skill |
| --- | --- |
| App Design | [fincake-design](../skills/fincake-design/SKILL.md) |
| Bug Fix | [fincake-bugfix](../skills/fincake-bugfix/SKILL.md) |
| Build and Test | [fincake-validation](../skills/fincake-validation/SKILL.md) |
| GitHub APK | [fincake-github-apk](../skills/fincake-github-apk/SKILL.md) |
| Google Play | [fincake-google-play](../skills/fincake-google-play/SKILL.md) |

Agent obsahuje len rolu, hranice a odkaz na postup. Skill obsahuje pracovny
postup bez jeho duplikovania v agentovi. Google Play nacita navyse iba postup
pre release alebo upravu konzoly, nie oba automaticky.

Skills su dostupne aj cez `/fincake-...`, ked ich VS Code objavi.
Nie su sukromne pre jedneho agenta: bezny agent ich moze pouzit pri rovnakej ulohe.
Ak este nie su v zozname, obnov okno; odkaz v agentovi umoznuje precitat postup
aj priamo. Samotne vytvorenie suborov nepotvrdzuje ich nacitanie v bezacom chate.

## Ako setrit tokeny

- Drobnosti ries s beznym agentom; na vacsiu ulohu vyber jedneho specialistu.
- Posli ciel, dotknutu obrazovku/subor, konkretnu chybu alebo cielovy release.
- Nepustaj vsetkych agentov naraz. Nie je tu staly Project/Release Manager:
  pri tomto rozsahu by opakoval kontext bez pridanej hodnoty.
- Agenti nemaju pevny model ani dalsich subagentov. Model vyberas vo VS Code;
  samotne definicie negarantuju nizsiu spotrebu ani cenu.
- Spolocne pravidla su v [AGENTS.md](../../AGENTS.md), existujuce Expo pravidla
  ostavaju v [portfolio-mobile/AGENTS.md](../../portfolio-mobile/AGENTS.md).

## Opravnenia a limity

Prikazy typu "nahraj APK na GitHub" alebo "nahraj AAB do interneho testovania"
autorizuju iba dany krok. Bez vyslovneho zadania sa agent pred publikovanim alebo
zmenou v konzole spyta. Upload neautorizuje produkcne vydanie.

Tieto subory su instrukcie, nie bezpecnostna izolacia ani nove integracie.
Nenastavuju prihlasenie, podpisove kluce, GitHub write pristup ani Play API.
Google Play postup vychadza z existujuceho
[kontrolneho zoznamu](../../portfolio-mobile/store/GOOGLE-PLAY.md);
blokatory sa musia overit, nie automaticky povazovat za splnene.
