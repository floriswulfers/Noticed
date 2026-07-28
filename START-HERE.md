# Noticed — running it on your computer

Follow these in order. Anywhere you get stuck, stop and tell me exactly what you see.

## What you need first (one time)
1. **Node.js** — the thing that runs the app.
   Go to nodejs.org, download the "LTS" version, install it like any app.
   To check it worked: open Terminal (Mac) or Command Prompt (Windows) and type:
   node --version
   If it prints a number (like v20.x.x), you're good.

## Setting up the project
2. Put this whole `noticed` folder somewhere easy, like your Desktop.
3. Open Terminal / Command Prompt.
4. Go into the folder. Type `cd ` (with a space), then drag the noticed folder
   onto the Terminal window and press Enter. That moves you inside it.
5. Install the pieces (one time). Type:
   npm install
   Wait a minute or two while it downloads. Normal.

## Adding your keys
6. In the noticed folder, find the file `.env.local.example`.
   Make a copy of it, and rename the copy to exactly `.env.local`
   Your Supabase values are already filled in.
   The Anthropic key line is blank for now (we add it together).

## Running it
7. In Terminal, type:
   npm run dev
8. It will say something like "ready on http://localhost:3000"
9. Open that address in your browser (Chrome).
10. There's your app — walk through the threshold, and whatever you keep
    is now saved in your real database. Close it, reopen tomorrow: still there.

## To stop it
Press Ctrl + C in the Terminal.
