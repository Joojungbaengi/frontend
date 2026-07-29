"use client";

import dynamic from "next/dynamic";

const ArBreweryExperience = dynamic(
  () => import("@/components/ArBreweryExperience"),
  {
    ssr: false,
  }
);

export default function ArBreweryClient() {
  return <ArBreweryExperience />;
}