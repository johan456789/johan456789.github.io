---
title: "Why Password Managers Are Both More Convenient and Secure"
description: "A deep dive into why password managers beat custom password schemes on security, convenience, and ease of management."
tags:
  - security
  - password-manager
date: 2023-08-16T19:47:44-04:00
---

I recently read a post on [Reddit](https://www.reddit.com/r/changemyview/comments/15sq1vm/cmv_password_manager_tools_and_systems_arent/) that says coming up with their customized password system/scheme is sufficient. An example system is this:

> If you used the last three letters of a website in reverse and add math, every website is easy. For example:
>
> Reddit -> Tid12*12=144
>
> Yahoo -> Ooh12*12=144

This post is a response to the Reddit post. In my view, a password manager offers higher security, convenience, and ease of management. All of these are better than the customized system assuming you trust the company that makes the password manager. To be honest, I also used to use a password scheme in the past, but over the years the greater convenience and security offered by using a password manager makes it an easy choice for me to stop using any password schemes. Let me explain why password managers are BOTH more convenient and secure.

## 1. Security

Using a password manager ensures all your password is unique and not shared with any website. Say you use a pattern system by first creating a passphrase similar to `CorrectHorseBatteryStaple` and concatenating it with some patterns derived from the website, e.g. `CorrectHorseBatteryStaple144`. Since you are manually creating the passphrase and it's difficult to remember many unique passwords in your brain, I'd assume you use a small set of passphrases (potentially just one passphrase) for the generation of all your passwords.

In the case of a leak or breach of a website, let's consider what's different.

### With a password manager (PM)

* You trust that the PM do everything they said they do correctly so all you need to do to ensure future security is to change that **ONE** website's password.
  * Since other websites use totally different passwords, no change is needed elsewhere.
* A bonus of using a PM is that you have **phishing protection**. Internationalized Domain Names (IDN) allows unicode in URL and a phishing website can look identical to human eyes ([example](https://9to5mac.com/2017/04/20/how-to-spot-a-phishing-attempt-fake-apple-site/)) but can't fool a computer the code is entirely different even if it looks similar when rendered.
* Another bonus of using a PM is that many actively monitor leaks and will notify you if one that affects you is detected.

### With a password pattern scheme

* You need to update **ALL** websites that use the same base passphrase as the breached website. Remember all you need is one badly written website that stores plaintext passwords to have your password leaked; even if they're hashed they could be cracked if it uses a weak hashing algorithm. You as a user have no idea which is the case unless they tell you, and even then you can only trust their words.
  * You need to remember in your head what websites are reusing the base passphrase since you don't use a password manager.
* You don't get the bonus of phishing protection. YOU have to be aware of potential phishing attacks.
* You don't get the bonus of getting notified of a leak and have to rely on the website to tell you or read it on the news.

* A password scheme is just an algorithm. And it's very simple to write some code to include your pattern in the cracking tool. Your system is doing [security through obscurity](https://en.wikipedia.org/wiki/Security_through_obscurity), which is not recommended by NIST.

  > [NIST SP 800-123, Guide to General Server Security](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-123.pdf)
  >
  > 2.4 Server Security Principles
  >
  > Open Design—System security should not depend on the secrecy of the implementation or its components.  

  You're relying on hackers not knowing how your pattern works or your pattern generation algorithm not commonly used by the public.

### PM as the single point of failure

Yes, the PM is the [single point of failure](https://en.wikipedia.org/wiki/Single_point_of_failure) but even when it fails to secure the server, all the hacker gets is an encrypted vault, which is useless without your master password (assuming the PM uses a secure encryption).

It depends on the individual to make the call here. I personally use a cloud PM for convenience. The main risk for me is the client-side vulnerability of PM (plaintext password leak on your own computers/tablets/phones) and keyloggers on my devices. These are the risks you have too. You trust all your browser extensions with permission not to [read your password](https://superuser.com/a/1066399/829597) and you believe all software you install is not malware. What's different is that I also trust the PM extension, the desktop/mobile app I use, and the PM server not getting hacked.

>putting all your passwords into a service that is subject to access by its employees is actually risky and I'm not sure why people think it's ok.

You're mistaken unless you assume PM companies lie and don't do [end-to-end (E2E) encryption](https://en.wikipedia.org/wiki/End-to-end_encryption).

In simple terms, the vault is encrypted on your device, the encrypted vault is sent to the server, and when you want to access the vault, the encrypted vault is synced back to your device and decrypted on your device. To my knowledge, all major PMs use E2E encryption. This is something you make sure of before adopting a PM as your password system. With E2E encryption, the PM company has NO way to access your vault unless they somehow know your plaintext master password, which shouldn't leave your device at all.

In the unlikely case of PM server breaches, PM uses the master password you type in to encrypt the vault on your device before it's sent in the network, so without your master password, it's no use and the hacker can't decrypt the vault. IMO, the significant risk of using a cloud PM is a client-side vulnerability, not the server, and when the client is compromised, you're at risk with your password pattern scheme too.

### In both cases

Depending on the hashing algorithm used by the website, the password potentially is leaked and it's best to assume it IS leaked to be safe. This is the reason you should vet the websites and services you use to reduce data leaks. Don't use shady websites.

### Summary

Using a PM you get **better damage control** in case of a leak or breach does happen and each website's security doesn't depend on other website's security because no part of the password is reused. By using a PM, You put almost all trust in the PM company and not the hundreds of websites you use so the attack surface is much smaller.

I don't know if you realize this, but you say it's sufficient to use such a pattern system because you trust the websites you use more than a PM user does and also more than PM companies. This is a judgment call made by individuals. I personally would trust a company that's an expert in security rather than hundreds of websites that I have no idea of their technical expertise. In contrast, PM companies publish their security white papers and practices, and you can read them to make a judgment.

## 2. Convenience

### With a (cloud) password manager

* Only one password to remember
* Assuming you always have your phone with you and charged, you have access to your vault anywhere anytime. You can look at PM app to type the password in any device you want. Your phone doesn't need to have access to the Internet unless you changed the password on another device and it's not yet synced.
  * I personally don't log in on others' devices at all. So almost all my devices have PM app installed. I only need to copy-paste from my PM mobile app in rare cases.
* By storing Two-Factor/Two-Step Authentication (or 2FA) codes in PM, you get instant fill-in of email/username, the password and 2FA code when the PM is already unlocked, giving you a smooth login experience. (Strictly speaking, it's just 2-step, not 2-factor, 1Password has [an article](https://blog.1password.com/1password-2fa-passwords-codes-together/) about it). As previously mentioned, you get phishing attack protection as a bonus and you don't need to worry much about auto-filling to the wrong website because it's handled by the PM. You only need to be cautious when copy-pasting from PM app manually.

### With a password pattern scheme

* Only one (or a small number of) passphrases(s) but also pattern generation rule to remember
* You can type your passwords from your head to any device you want.
  * This is indeed a pro of your system but I don't think it's worth the tradeoff in security and ease of management. And I don't know about you but I do always have my phone. Again this is an individual's call.
* You have to manually type the password and find your 2FA app to copy-paste the code. Additionally, you need to be careful about phishing attacks, and in some cases (previous [example](https://9to5mac.com/2017/04/20/how-to-spot-a-phishing-attempt-fake-apple-site/)) you can't tell just by looking at the URL.

### In both cases

* You get fast typing the master password or the base passphrase(s)
* With 2FA and assuming using a time-based one-time password (TOTP) for most people's cases, you get a time-invariant password for security, and an added benefit of a small attack window offered by TOTP (because it's time-based) when an unknown device tries to access your account.

### Summary

If you always have your PM app on your phone, it's at least as convenient to use a PM as your password pattern scheme. I'd say it's more convenient and secure than your scheme because of auto-filling and phishing attack protection.

## 3. Ease of Management

### With a (cloud) password manager

* PM remembers which email to use and which login method to use (Google, Facebook, Apple, etc.) on each website.
* When you need to update from one email to another (maybe you want to change the email or it is compromised), you can find all of the accounts with that email in PM with a simple search.

### With a password pattern scheme

* You have to remember which email to use and which login method to use on each website.
* When you need to update from one email to another, you have to recall the hundreds of websites you use in your head. I can't do that so I use a PM.

## Summary

>Discovering that password managers are more effective, secure, and easy to use than I believe.

The password pattern system you use is also a single point of failure because of the shared base passphrase. Password managers provide stronger security, more convenience through auto-fill, easier management, and better damage control in case of a website breach.

>Learning how you solve the password manager problem when you're not on your computer - at work, a friend's house, a hotel business computer

You can access your password manager vault from the mobile app.
