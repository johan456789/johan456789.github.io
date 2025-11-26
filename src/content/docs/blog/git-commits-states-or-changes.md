---
title: "Are Git Commits States or Changes?"
date: 2025-03-30T22:39:29+08:00
tags:
  - git
  - jj
---

I recently got confused while I was using Git. Does each Git commit store states or changes? I remember they store states, but why do I sometimes *feel* they store changes/diffs?

A few years ago, I read [The Design of Everyday Things](https://www.goodreads.com/book/show/840.The_Design_of_Everyday_Things), and learned the terms "conceptual model" and "mental model". A conceptual model is a simple representation of how things work, and a mental model is the user's internal understanding of it. When there's a mismatch between the two, confusion arises and it might further lead to user errors.

<!-- excerpt -->

## The Confusion

> Does each commit represent a state or a change?

This seemingly simple question is actually quite hard to answer when you consider different situations.

When writing git commit messages, we often write "fix: some bug" or "feat: some new feature". So a commit is a change? Your mental model thinks they represent changes.

When you checkout a commit, your working directory will change to the state represented by that commit. So a commit is a state? Your mental model now thinks they represent states. The commit message simply describes the changes that *lead to* that state.

What about a `git merge`? What does it even mean to merge two states? It actually means merging the changes. Now your mental model thinks a commit is a change instead of a state. The merge commit represents the new state that includes all the work from the two branches and crucially, it's actually a commit that introduces *no* changes because the changes are in the parent commits.

Confusing, right? Sometimes a commit acts like a snapshot of your project, other times it’s all about changes.

## The State Model: Snapshots of Your Project

At its core, Git stores each commit as a full snapshot — a complete picture of your repository’s tracked files at a specific moment.

- git checkout \<commit\>

  When you run this, Git restores the exact state of your working directory to match the commit’s snapshot. It's like loading a saved point in a game.

- git diff \<commit\>^ \<commit\>

  This compares a commit’s state to its parent’s state, showing the changes it introduced. The diff is calculated on the fly from two snapshots.

## The Change Model

Despite storing states, Git’s workflow often makes you feel like commits are *changes* instead. You get this change model when you manipulate history or describe your work as edits in commit messages.

- Commit Message

  When you write a message with `git commit -m "<message>"`, you describe what changes — not the full state. e.g., "Fix typo in README" describes the change, not the entire repo’s contents.

- git rebase

  Rebase moves commits by reapplying their changes onto a new base. Git takes the diff from each commit (relative to its parent) and builds new snapshots.

- git cherry-pick \<commit\>

  This picks a commit’s changes and applies them to your current branch. Git uses the diff between the commit and its parent to create a new snapshot (commit).

## Comparing Git with Jujutsu

I recently learned about [Jujutsu](https://github.com/jj-vcs/jj), or `jj` for short, and it has a well-designed conceptual model that helps users form accurate mental models.

Git commits store **states**, but the workflow often emphasizes **changes**. Git conflates the two and they are both referred to as "commits" with the same commit ID.

`jj`, in contrast, separates the two and it has two types of IDs: [change IDs](https://docs.jj-vcs.dev/latest/glossary/#change-id) and [commit IDs](https://docs.jj-vcs.dev/latest/glossary/#commit-id). A change ID refers to the [change](https://docs.jj-vcs.dev/latest/glossary/#change) that is introduced by a commit. A commit ID refers to a [commit](https://docs.jj-vcs.dev/latest/glossary/#commit) representing the state of the repository at a specific point in time, i.e. a snapshot. This distinguishes the two and makes it much clearer and easier to understand.

I plan to explore more about `jj` and see if working with it is simpler than using Git. But that's for another day.

## Conclusion

Git commits represent both states and changes. A git commit technically stores a state (snapshot) but common git operations often treat a commit as a change. This distinction is not always clear and can be confusing. It is crucial to understand the two models to avoid mix-ups and mistakes.
