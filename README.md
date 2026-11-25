# Jot

Daily three habit tracker and quick notes (projects, notes, subtasks) in one offline app. Jot saves locally as you work and can automatically back up to your Supabase account.

## Install
1. Create a GitHub repo (e.g. `jot`) and upload every file in this folder to the root.
2. Settings → Pages → Deploy from branch → `main`, `/ (root)` → Save.
3. After a minute, open `https://<your-username>.github.io/jot/` in Chrome on your phone → ⋮ → **Install app** (or Add to Home screen).

Open Jot online once on each device so it can cache the app. Then you can reopen it offline, use the home-screen shortcuts, edit your lists and logs, and import or export JSON backups.

## Enable cloud backup
1. Create a [Supabase project](https://supabase.com/dashboard). In its **SQL Editor**, paste and run `setup-supabase.sql`.
2. In **Authentication → Users**, create an email and password user for Jot and confirm the email. Keep the password private.
3. Open the project’s **Connect** dialog and copy its HTTPS project URL and publishable key (`sb_publishable_…`).
4. In Jot, open **More → Cloud backup**, enter those project details, and sign in with the user you created. Existing data on that device will be backed up automatically. On another device, sign in with the same account to restore the cloud copy.

Jot saves on the device immediately and syncs shortly after edits while it’s open. If you close Jot while offline, open it again when you have a connection. If two devices have independent edits, **More → Cloud backup** asks you which copy to keep. Export your local copy before choosing if you want a separate copy of those edits. Use one Jot tab at a time in each browser profile.

To update an existing installation, publish at the same web address to keep the existing device data. If you move to a different address, export the data from the old address and import it on the new one.

## Moving your data over
Data doesn't follow between the Claude artifact and this installed version (or the old Daily Three app).
In the artifact: ⋯ → Export backup. In the installed app: ⋯ → Import backup and pick that file.

## Tips
- `#projectname` in a quick note files it under that project (a prefix works: `#rap` → Raptor).
- The calendar button on a note or subtask puts it into a daily three slot; flipping the breaker checks it off.
- ⋯ → Edit task lists changes the morning, evening small and big-task menus, plus "Your tasks" (the ones you've typed yourself, which show first in the picker).
- **+ Add a task** adds an extra slot for that day; **Remove this slot** in the picker drops one. ⋯ → Reset slots puts the day back to the default.
- **Daily** is a day planner. At the top, **Day | Events** switches views. The Day view has **Today's goal** (one line for the day), the **Flow of the day** and your **Focus** list.
- **Flow of the day**: your Daily 3 slots (marked *Daily 3*, still the only thing the streak counts) plus anything you add with **+ Add to the day**. Give an item a time for appointments and scheduled things; it lands in the right spot and shows its time on the left. **Reorder** moves things by hand. Today's flow shows a red *Now* line. Tap an item to edit it, change its time or move it to another day.
- **Focus**: the bigger things you're working on. They stay every day until you remove them; tap one to add it to the day's flow.
- **Events** view: a month calendar (green for Daily 3 done, tan for events, a dot for scheduled items; ‹ › change month, tap a day to open it) and a *Coming up* list of all-day events and scheduled items.
- **All-day events** (Daily → Events → + Event, or ⋯): hunting trips, holidays, travel. "Pause daily tasks" makes it a day off that doesn't break your streak (you can still plan tasks anyway). "Repeats every year" for holidays.
- **Goals**: each goal has a date countdown and any mix of trackers (Edit → + Add a tracker): Checklist (topics/milestones), Count (problems, chapters), Score (practice exams vs. a passing mark), Consistency (days a week, tap the day dots) and Time (hours). The first tracker with progress also shows on the Daily tab.
- **Standards**: workouts, recipes, grocery lists. Switch a doc to Checklist for things like groceries, then "Uncheck all" to reuse it.
- Notes → ⋯ → Reorder projects changes the order of the project sections. Each notes project is a collapsible section; opening one makes it where quick add files new notes (marked **Adding here**).
- Open a note to set its priority: **High** moves it to the top of its list, **Low** sends it to the bottom.
- Make a notes project called **Priorities**: everything in it, plus any high-priority note, shows first in the day planner (the picker when you tap a daily slot).
- Each active project or business has a **Work on … (1 hr)** option in the day planner. Finishing it logs an update on that project.
- Long typed notes and voice notes get a short title (about five key words, filler dropped), and the full text is kept as the note.
- Every group in the day planner, the Projects and Businesses sections, and each project stage can be collapsed. Jot remembers what you collapsed on each device.
- The Daily tab shows a quote each day; tap it for another.
- **More → Books**: a list of books to read. **Start** moves one to Reading now and **Finish** files it under Finished with the date.
- **Reading notes**: tap the mic on a book to dictate a note while you read. Add the page if you like. **Save, next note** saves it and keeps listening, so you can capture several thoughts in a row. Tap a book to see its notes, type one instead, or delete one.
- **Projects** tab: tracked projects (steps, target date, updates log, costs) and, in the Businesses section, one workspace per business with the sections you pick at setup (roadmap, products or services, orders or jobs, money, equipment, notes). Open a note → **Start as project** moves it out of the backlog; the calendar button on a step puts it in the daily three.
- **More → Car**: add a vehicle, update the odometer now and then, tap **Done** when you do a service. Jot estimates mileage between readings and predicts each due date (whichever of miles or months comes first). Anything due within 30 days shows on the Daily tab. **+ Fill-up** logs gas (gallons, cost, odometer) for mpg, days between fills and monthly fuel cost; **+ Expense** covers insurance, parking, repairs and the rest, and Spending totals it all by category.
- **Voice notes**: the mic next to the note box. Short dictation becomes the title; longer dictation gets a title from its first clause and keeps the full text in the note. For offline dictation, open Voice Notes while online and tap **Download offline dictation** if your browser offers it. If the browser or language lacks on-device speech recognition, you can still type and save a voice note offline.
- Workouts and Standards now live under **More**.
- `?tab=work`, `?tab=goals`, `?tab=docs`, `?tab=build`, `?tab=books` or `?tab=car` opens straight to that tab.
- Export a backup now and then.

## Updating
After changing any app file, bump the version suffix in `CACHE` in `sw.js` (for example, from `v8` to `v9`). Give Jot a moment online to fetch the update, then reopen it.
