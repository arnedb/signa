# Gamification ideas

Ideas for making practice more playful. None of this is built yet. Everything here is for
**personal use only**: nobody else sees your progress, not other students and not teachers.

## Hard rules

- **Never sound.** No sound effects, music, jingles or voice, not even as an option. Audio
  clashes with learning a sign language, and the app must work the same for Deaf and hearing
  users. All feedback is visual: movement, colour, the companion's face and hands. Sign videos
  stay muted, as they are now.
- **Personal only.** No leaderboards, no comparing with classmates, nothing in `/admin`.
- **Reward learning, not tapping.** Answers are self-graded ("Kende ik" / "Kende ik niet"),
  so a reward for "correct" tempts students to fool themselves. Reward knowing a sign in
  *both* directions, rescuing difficult words and coming back, not the number of taps.
- **No guilt.** Nothing is lost when you skip a day or a week. Evening-class students practise
  around a weekly lesson, not daily.
- **Derived from `results`.** Most of this can be worked out from the existing log of results,
  without new tracking.
- **Calm mode.** A setting ("Rustige modus") turns off the companion and the decorations and
  goes back to the plain app. Respect `prefers-reduced-motion`.

## The companion: a signing figure you look after

A cute figure that lives in the app and grows with you. Its name is a placeholder for now
("Gebaartje"?).

### Why it fits a sign language app

- **It signs, it never speaks.** It talks only through its hands and face. Every sign you
  collect is a sign it can use: it greets you with signs you know and celebrates with them.
  That turns your collection into something you can see.
- **Facial expressions matter.** In VGT the face is part of the grammar. The companion has a
  very expressive face (raised eyebrows for a question, a frown for "not") and so models
  this without saying so.
- **A name sign.** Instead of only a written name, the student picks or makes a name sign for
  the companion, like Deaf people get a name sign.

### Keeping it alive, without the guilt

The companion needs you, but it never dies and never punishes you.

- **Energy from practice.** Practising gives it energy. It is lively after a session, and it
  slowly gets sleepy when you have not practised for a while.
- **Sleeping, not dying.** After about a week without practice it falls asleep, curled up in
  its home. One short session wakes it up, glad to see you. This is the "Teruggekomen" moment:
  coming back is celebrated, never punished.
- **Tied to the lesson day.** The group already has a weekday. The companion gets a bit
  restless the day before class ("Les morgen!") and suggests the list from last lesson.
- **Food from rescued words.** A word that leaves "Mijn moeilijke woorden" (wrong before, right
  now) is a treat. This rewards working on your hardest words.
- **Mood, not health points.** No bar that goes to zero. Its mood shows in its face and how it
  moves: sleepy, content, happy, very excited.

### Growing

- **Its home grows with the course.** Each lesson or list is a room or a part of a garden.
  Mastering a list (every word known both ways) decorates that room. A complete year is a
  finished home. This doubles as the lesson map: one look shows which lessons you know.
- **Stages.** It grows as your collection grows: small at the start of year 1, bigger at
  100 signs, and so on. Years 2 and up could get a new stage or a new friend.
- **Things to unlock.** Hats, scarves, colours and objects for its home, earned at real
  milestones: first 100 signs, a perfect round on a list, a whole year mastered, both
  directions for a whole lesson.

### Where it shows up

- **Home screen:** the companion in its home, its mood, and one suggestion
  ("Herhaal list 1.4", "5 moeilijke woorden").
- **During practice:** small and in a corner, so it never covers the video. It reacts with a
  nod or a thumbs-up, not with a big animation after every card.
- **Round summary:** it celebrates with what you did: "3 nieuwe gebaren, 2 gered, list 1.3
  volledig". It signs one of the new words.
- **Dictionary:** collected signs are in colour, signs you have not collected yet are grey.

### Open questions

- **Who draws it?** A 2D figure (SVG or Lottie) is enough. Its hands must be able to make
  handshapes that are correct, or close enough not to teach anything wrong. A simple figure
  with clear hands is better than a detailed one with vague hands. Check its signs with a
  teacher.
- **How many signs can it make?** Animating every word is not realistic. Options: a small set
  of hand-made animations (greetings, "goed", "ja", "slaap"), or show the real class clip in a
  speech-bubble-like frame next to it.
- **Mobile:** a companion is a good reason for a home-screen widget later (milestone 9).
- **Data:** its state (mood, home, unlocked items) can be computed from `results`. Only the
  choices the student makes (name sign, chosen hat) need storing.

## Playful, colourful design

If the companion comes, the app's look should match it. Today it is "modern, but plain".

- **Colour:** a bright, warm palette instead of mostly neutral. Each year or lesson its own
  colour, used in the lesson map, list tiles and the companion's rooms. Keep contrast at
  WCAG AA for text, and check dark mode.
- **Shapes:** rounder corners, thicker outlines, cards that look like tiles or stickers.
- **Type:** a friendly, rounded font for headings. Keep a plain, very readable font for body
  text and word names.
- **Motion:** small, quick movement for feedback (a card that pops, a tile that fills). It
  replaces sound, so it must be clear. Never in the way of the sign video, and off with
  `prefers-reduced-motion`.
- **Still serious about the video.** The sign video is the most important thing on the screen.
  Decoration goes around it, never over it.
- **Admin stays plain.** The teacher tools (`/admin`) keep the calm, functional look.

## Other ideas

From the first brainstorm. These fit with or without the companion.

1. **Sign collection ("Mijn gebaren").** Each sign is *gezien* (seen), *gekend* (known one
   way) or *beheerst* (known both ways). A list shows "23 / 31 verzameld".
2. **Lesson map.** The lists of a year as tiles that fill up. Answers "am I ready for
   lesson 3?". With the companion, this is its home.
3. **Rescued words.** "12 woorden gered deze maand".
4. **A richer round summary** instead of only "18/20".
5. **Weekly rhythm instead of a daily streak.** "Practised in 6 of the last 7 weeks", or a goal
   you set yourself. Nothing resets.
6. **Lesson countdown** from the group's weekday.
7. **Challenge modes (opt-in):** sprint (60 seconds, sign → word), perfect round, mixed bag of
   everything you collected.
8. **Personal records:** longest run of correct answers, best sprint.
9. **A few meaningful badges:** "Eerste 100 gebaren", "Jaar 1 volledig", "Beide richtingen",
   "Teruggekomen".
10. **Year in review** at the end of the course year.

A good first step, with or without the companion: collection, rescued words and the richer
round summary (1, 3, 4). The companion builds on exactly those.

## Later: fingerspelling "galgje" with the camera

A hangman game ("galgje") for the fingerspelling alphabet. Most useful for first-year
students, who learn the alphabet first. It could be really fun with a good alphabet detection
model.

### How it plays

- The app picks a word (from the student's own collected words, so it also repeats
  vocabulary) and shows blanks.
- The student **fingerspells a letter to the camera**. The model recognises the handshape and
  fills in the letter, or counts a miss.
- Instead of a gallows, misses could do something friendlier: the companion's balloon
  deflates, or a picture is slowly covered. No hanging figure.
- **Without a camera:** pick letters from a grid that shows each handshape. Still useful to
  learn the alphabet.
- **Reverse mode (receptive):** the app fingerspells the word letter by letter (clips or a
  drawn hand), and the student guesses the word. Reading fingerspelling is often harder than
  making it, so this may be the more useful mode.

### The detection model

- **On the device only.** Run hand-landmark detection in the browser (for example MediaPipe
  Hands), then a small classifier on the 21 landmarks. No video leaves the device, which keeps
  the privacy promise (no real name, no email, and no camera images either).
- **Training data:** landmarks, not video, from volunteers who agree to it (teachers, students,
  Deaf signers). Landmarks are small and say little about who someone is.
- **Letters with movement** (in many alphabets J and Z, and others depending on the VGT
  alphabet) need a short sequence of frames, not one pose. Start with the static letters.
- **Check the alphabet** with a teacher: VGT's fingerspelling alphabet, and LSFB's for French-
  speaking schools, since every school teaches one sign language.
- **Left-handed signers:** mirror the landmarks, or train on both hands.
- **Confidence:** only accept a letter when the model is sure for a few frames in a row, and
  show what it sees, so a wrong detection does not feel unfair.
- A good portfolio piece on its own: a small, documented model with an evaluation per letter.
