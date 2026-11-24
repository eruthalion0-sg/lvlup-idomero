# LvL Up – Időmérő rendszer

React/Vite webalkalmazás a hét eszköz időméréséhez, külön tulajdonosi és pultos PIN-nel.

## Díjszámítás
Az első 70 perc 1 óra. 1:11-től 1,5 óra, 1:41-től 2 óra, majd minden további 30 perc túllépésekor újabb félóra. A számlázás egész percre felfelé kerekít.

## 1. Supabase
1. Hozz létre egy projektet: https://supabase.com
2. SQL Editorban futtasd a `supabase/schema.sql` fájlt.
3. A Settings → API részen másold ki a Project URL-t és az anon/public kulcsot.

## 2. PIN-ek és Edge Function
A két PIN különböző, saját választású kód legyen. A PIN-ek SHA-256 hashét a következő PowerShell paranccsal készítheted el:
```powershell
$pin='SAJAT_PIN'; $bytes=[Text.Encoding]::UTF8.GetBytes($pin); [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLower()
```
Supabase CLI-vel linkeld a projektet, majd állítsd be a titkokat:
```bash
supabase login
supabase link --project-ref SAJAT_PROJECT_REF
supabase secrets set OWNER_PIN_SHA256=TULAJ_HASH STAFF_PIN_SHA256=PULTOS_HASH TOKEN_SECRET=LEGALABB_32_VELETLEN_KARAKTER
supabase functions deploy pos-api --no-verify-jwt
```
A Supabase Edge Function titkai között a Supabase rendszer automatikusan biztosítja a `SUPABASE_URL` és `SUPABASE_SERVICE_ROLE_KEY` értékeket. A service-role kulcsot soha ne tedd a frontendbe vagy GitHubra.

## 3. Cloudflare Pages
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Csatlakoztasd ezt a GitHub repositoryt: `eruthalion0-sg/lvlup-idomero`.
3. Build command: `npm run build`; output directory: `dist`.
4. Add build environment variables: `VITE_SUPABASE_URL` és `VITE_SUPABASE_ANON_KEY`.
5. Deploy után kapsz egy ingyenes `*.pages.dev` webcímet.

## Funkciók és korlátok
- 7 külön stopperóra, több egyidejű aktív játékkal.
- Aktív játékok szerveren tárolva, böngészőbezárás után is folytatódnak.
- A többi eszköz állapota 5 másodpercenként frissül.
- Tulajdonos: statisztika és forgalmi napló; pultos: csak stopperoldal.
- A napló legfeljebb az utolsó 2000 lezárt játékot tölti be.
- Az óradíjak jelenleg a frontendben és az Edge Functionben rögzítettek; módosításuk fejlesztői frissítést igényel.
- A PIN-végpont éles használat előtt további rate-limit/WAF védelemmel erősíthető.
