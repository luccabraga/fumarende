# fumarende — QA checklist

## Foundation

- [ ] `curl http://localhost:4173/api/health` returns `{"ok":true}` after
      `./scripts/install-launchd.sh`.
- [ ] From another device on the same Wi-Fi, `http://<mac-hostname>.local:4173`
      loads the login/setup screen in a browser.
- [ ] First visit shows the password **setup** form, not login.
- [ ] After setup, reloading the page stays logged in (session cookie
      persists).
- [ ] Logging out and reloading shows the login form (not setup).
- [ ] Entering the wrong password shows an error and does not log in.
- [ ] Adding a Receitas entry appears in the list immediately without a
      manual refresh.
- [ ] Killing the server process (`kill -9 <PID>` from
      `launchctl list | grep com.lucca.fumarende`) results in it being
      relaunched automatically within a few seconds (`KeepAlive`).
- [ ] Rebooting the machine brings the server back up without any manual
      step (`RunAtLoad`).

## Câmbio

- [ ] Câmbio page loads from the nav (no longer "em breve").
- [ ] Typing USD amount + contracted rate shows the live preview
      (BRL bruto / IOF+tarifas / BRL líquido / VET / spread).
- [ ] Leaving PTAX blank shows "— (sem PTAX)" and still saves.
- [ ] A submitted contract appears in the list immediately with its VET,
      and the summary card totals update.
- [ ] Deleting a contract removes it from the list and the summary
      without a manual refresh.
- [ ] An invalid entry (blank USD, non-numeric rate) shows an inline
      error and saves nothing.
- [ ] Receitas: an entry with a "Valor (US$)" shows the USD amount in
      parentheses next to the BRL amount.

## Gastos + Parcelas

- [ ] Gastos page loads from the nav (no longer "em breve").
- [ ] A one-off expense appears in the list immediately; the
      Total / Essencial / Não-essencial card updates without a refresh.
- [ ] An expense with N parcelas creates N rows dated one month apart,
      each labelled (i/N), summing exactly to the purchase amount.
- [ ] Deleting a non-installment expense removes just that row.
- [ ] Deleting an installment expense (from Gastos or Parcelas) removes
      the whole group.
- [ ] Parcelas page shows one row per installment purchase with the
      paid count and the remaining BRL.
- [ ] Adding a fixed expense and clicking "Aplicar ao mês atual" creates
      one expense dated the 1st; clicking again creates none.
- [ ] An invalid expense (blank description, non-numeric amount) shows an
      inline error and saves nothing.

## Reserva

- [ ] Reserva page loads from the nav (no longer "em breve").
- [ ] With no essential expenses, the status card shows the "registre
      seus gastos essenciais" prompt.
- [ ] A deposit raises "Já guardado" and appears in the history with a
      `+`; a withdrawal lowers it and shows a `−`.
- [ ] A withdrawal larger than the current balance shows the inline
      warning but still records.
- [ ] Setting the Meta Mensal to a % resolves against this month's
      Receitas income; setting a fixed value uses that value as-is.
- [ ] A month's target does not change after the fact when more income
      is added later (frozen on first view).
- [ ] Deleting a history entry updates the balance without a refresh.

## Metas + Projetos Especiais

- [ ] Both pages load from the nav (no longer "em breve").
- [ ] Creating a goal shows a card with the current/target amounts, a
      progress bar, and a "Faltam …" line.
- [ ] With a future "data alvo", the card shows a "sugestão R$ X/mês".
- [ ] "Adicionar" raises the current amount without a manual refresh.
- [ ] "Editar" can change the name, target, current amount and date.
- [ ] When current reaches the target the card shows "Concluída" and
      drops the suggestion line.
- [ ] "Excluir" removes the card.
- [ ] Projetos Especiais has a "Motivação" field that shows as an italic
      quote on the card; Metas does not.

## Análise

- [ ] Análise page loads from the nav (no longer "em breve").
- [ ] Resumo shows Receitas, Gastos, Saldo, and the Essencial /
      Não-essencial split from the real data.
- [ ] "Gastos por categoria" shows one bar per category, largest first,
      widths proportional.
- [ ] "Projeção 12 meses" shows a year-end total and a rising line when
      a monthly savings target is set; shows the "Configure sua meta
      mensal" note when it is 0.
- [ ] "Cenários" lists each não-essencial category with a 0–100% slider;
      moving a slider updates the "Corte total …/mês · … em 12 meses"
      line.
- [ ] With no expenses, the category and cenários sections show their
      empty-state text.
