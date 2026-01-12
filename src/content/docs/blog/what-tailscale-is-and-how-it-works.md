---
title: "What Tailscale Is and How It Works"
description: "Tailscale is a modern mesh VPN built on WireGuard. It’s unlike traditional VPNs that has a central server that you need to connect to. It has an interesting design that’s worth learning about."
tags:
  - tailscale
  - vpn
  - networking
date: 2026-01-13T01:42:14+08:00
draft: true
---

To set up a traditional VPN at your home, you need to go through a laborious setup like configuring static IP addresses and/or using a [dynamic DNS](https://en.wikipedia.org/wiki/Dynamic_DNS), port forwarding, etc. Been there, done that. It was not fun at all.

Tailscale in contrast is way simpler to use. All you need to do is install Tailscale on all devices you want in the private network and login with your Tailscale account. That's it!

I'm so happy to finally try it out. It makes accessing my home computer a breeze. But it also got me thinking, how does it work? I googled around and read the two official [blog](https://tailscale.com/blog/how-tailscale-works) [posts](https://tailscale.com/blog/how-nat-traversal-works) and here I'll share the high-level overview of how it works.

## What Tailscale Does

Tailscale creates a [mesh](https://en.wikipedia.org/wiki/Mesh_networking) [overlay network](https://en.wikipedia.org/wiki/Overlay_network) that allows you to connect to your devices directly.

Tailscale [defines](https://tailscale.com/learn/understanding-mesh-vpns) a mesh network as:

> A mesh network is a type of networking topology in which different nodes dynamically connect to each other in order to improve the overall efficiency of data transmission.

This means the devices are connected to each other directly similar to other peer-to-peer (P2P) networks like BitTorrent or mesh Wi-Fi networks.

And an overlay network is a *logical* network that is built on top of another network. So mesh Wi-Fi being a physical network is not an overlay network, while Tailscale and BitTorrent are overlay networks.

The Tailscale overlay network, or as they call it, "tailnet", is split into two parts: the control plane and the data plane. The control plane is the coordinator and the data plane is the actual network where data flows.

## The Control Plane

The control plane handles identity, key exchange, and access rules, then tells devices how to find each other. It coordinates, but does not carry your traffic.

## The Data Plane

Devices establish direct, end-to-end encrypted connections whenever possible, so data flows device to device.

## The Firewall and NAT Traversal

When direct connections are blocked, Tailscale helps devices discover workable paths and can fall back to relays. The traffic remains end-to-end encrypted either way.

## Identity-Based Security

Access is based on users and devices, not IP addresses. Policies follow identity, which makes permissions easier to manage and audit.

## Why It’s Different from Traditional VPNs

There’s no central bottleneck, the network scales naturally as you add devices, and everyday use feels closer to being on the same LAN.
