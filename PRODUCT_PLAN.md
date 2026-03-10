# AskChessGPT Product Plan

## Product Direction

AskChessGPT should become a learning-first chess product, not a generic play-against-AI website.

Core promise:

Learn chess by asking better questions.

The board is still central, but it should support explanation, reflection, and training. The product should help a player understand:

- why a move works
- what idea they missed
- what each side should do next
- how to improve from repeated mistakes

The product should not compete directly with Chess.com or Lichess on breadth. It should instead occupy a clearer niche:

An AI chess explainer for club players who want engine-quality guidance in human language.

## Target Audience

Primary audience:

- players rated roughly 700 to 1800 Elo
- adults improving on their own
- players who already use Chess.com or Lichess to play games
- players frustrated by engine lines that do not explain themselves

Secondary audience:

- coaches who want a fast explanation layer for student mistakes
- content creators who want shareable annotated positions

Not the initial focus:

- complete beginners who do not yet know how pieces move
- tournament-level players looking for deep opening prep
- users who only want a free bot to play against

## Business Model

### Free Experience

- no login required before first value
- instant homepage entry into a sample position or learning board
- limited daily questions about positions
- limited number of reviewed mistakes or guided drills

### Paid Experience

- unlimited position questions
- full game review with move-by-move explanations
- personalized drills generated from mistakes
- saved study history
- structured study plans
- richer engine explanations and candidate move breakdowns

### Recommended Pricing

- free tier with meaningful limits
- pro monthly: $9 to $12 per month
- pro annual: $69 to $89 per year
- later coach tier: $24 to $39 per month

The product should sell understanding and improvement, not stronger bot strength.

## Information Architecture

The site should evolve into a small but focused product with clear surfaces.

### 1. Homepage

Purpose:

- communicate the learning-first value proposition in under 5 seconds
- make the brand feel premium and distinct
- drive users directly into trying the product

Messaging direction:

- headline should be about asking positions, understanding moves, and improving faster
- do not lead with generic "play against AI"
- do not use dashboard-style product language

Suggested headline territories:

- ASK THE POSITION
- LEARN CHESS BY ASKING WHY
- STOP GUESSING. START UNDERSTANDING.

Suggested supporting copy:

- Ask any chess position a question.
- Get candidate moves, plain-language explanations, and practical training.
- Built for players who want to improve, not just play.

Homepage sections:

1. Minimal top navigation
   - brand identifier on the left
   - subtle divider in the center
   - right-side status label such as LEARNING BETA or ANALYSIS STUDIO

2. Hero section
   - oversized editorial headline
   - small label line above it
   - supporting paragraph under or beside it
   - primary CTA: Try a Position
   - secondary CTA: Explore How It Works

3. Product framing section
   - explain how users interact with the board
   - answer what the product does differently from engine-only analysis

4. Learning pillars section
   - Why this move?
   - What did I miss?
   - What is the plan?
   - Train this mistake

5. Position demo or walkthrough
   - show a sample position with natural-language explanation
   - make the product feel tangible before entering the app

6. Conversion footer section
   - prompt users to start a session
   - optional waitlist or email capture only if necessary later

Visual direction:

- cinematic editorial look
- matte charcoal background
- warm beige type
- coral-rust accents
- no gradients
- no pill buttons
- 4px radius max
- fixed noise overlay
- oversized uppercase typography with tight leading

### 2. Learning Board Page

Purpose:

- the main interactive product surface
- users play through a position or a light game flow while constantly asking questions

Core layout:

- board as the center anchor
- right or lower explanation panel for chat and guided prompts
- compact move history and evaluation context
- limited controls, strong hierarchy

Core interactions:

- ask a freeform question about the position
- use one-click prompts:
  - Why is this move good?
  - What should I play here?
  - What is Black's plan?
  - What did I miss?
  - Give me 3 candidate moves
- click a move and get explanation
- request a drill from a mistake

Learning board states:

- sample position mode for first-time users
- self-play or guided play mode
- analysis mode for reviewing a move sequence

The board page should feel like an analysis studio, not a game dashboard.

### 3. Review Page

Purpose:

- show users how they made mistakes and what pattern repeated

Key content:

- key mistakes
- missed tactics
- positional misunderstandings
- better candidate moves with explanation
- short improvement summary

This page becomes highly monetizable later because it converts users from curiosity into training.

### 4. Training Page

Purpose:

- convert analysis into practice

Modules:

- retry your mistake
- best move challenge
- tactic from your game
- plan recognition

This is where the product becomes sticky rather than just interesting.

### 5. Pricing Page

Purpose:

- frame the product as a premium improvement tool, not a commodity utility

Should emphasize:

- unlimited questions
- personalized review
- training from mistakes
- saved study history

### 6. Optional Blog / Insight Pages

Purpose:

- SEO and brand authority
- acquisition for queries about chess understanding

Good topics:

- why is this move good
- how to analyze your own games
- common mistakes at 800, 1200, 1600
- how to turn engine lines into real understanding

## Product Principles

1. No login before value.
2. The product teaches first, plays second.
3. Explanations must be more important than raw engine output.
4. The UI must feel premium and memorable, not generic SaaS.
5. Every screen should reinforce improvement, not just activity.

## Technical Direction

### Frontend

- remove login from the main flow
- remove telemetry and passive visit tracking
- reduce screen clutter and rebuild around the board and explanation panel
- use one clean landing experience before the learning board
- remove legacy or unused worker artifacts

### Backend

- keep backend as the single source of chess move generation
- improve difficulty by using real Stockfish strength controls where available
- avoid depth-only scaling because low Elo still plays too strongly
- later return richer structured analysis, not only a single move

### Chat / Tutor Layer

- respond like a chess coach, not a generic assistant
- provide useful fallback behavior if the LLM is unavailable
- generate explanation types:
  - move explanation
  - candidate moves
  - plan for both sides
  - tactical alert
  - mistake explanation

## Implementation Phases

### Phase 1: Product Reset

- remove login entry points from the main site
- remove telemetry and broken logging
- replace current homepage with learning-first editorial landing page
- preserve ability to launch into the board quickly

### Phase 2: Learning Board Foundation

- simplify board layout
- add guided prompts
- improve explanation UX
- keep game controls secondary to learning interactions

### Phase 3: Difficulty and Engine Quality

- fix low-Elo behavior
- configure engine strength properly
- add more human-like low-level play
- stabilize move parsing and error handling

### Phase 4: Review and Training Loops

- add review page and training modules
- convert mistakes into drills
- create retention loop around improvement

### Phase 5: Monetization and Accounts

- add optional accounts only after strong anonymous value delivery
- introduce premium limits and saved study history
- launch pricing page and upgrade flow

## Immediate Implementation Priority

The best thing to do right now:

1. Rewrite the homepage around the learning-first product promise.
2. Remove login UI and telemetry from the main experience.
3. Simplify the app shell so the board feels like a premium analysis studio.
4. Fix engine difficulty next so beginner strength behaves credibly.

That sequence improves product clarity first, then trust, then gameplay quality.