package com.claudecode.remote.util

import android.icu.text.Transliterator
import java.text.Normalizer
import java.util.Locale

object AlphabeticalSort {
    private val transliterator: Transliterator by lazy(LazyThreadSafetyMode.NONE) {
        Transliterator.getInstance("Han-Latin; Latin-ASCII")
    }

    fun sectionKey(value: String?): String {
        val first = sortKey(value).firstOrNull { it.isLetterOrDigit() } ?: return "#"
        return if (first.isLetter()) {
            first.uppercaseChar().toString()
        } else {
            "#"
        }
    }

    fun sortKey(value: String?): String {
        val raw = value?.trim().orEmpty()
        if (raw.isEmpty()) {
            return "~"
        }
        val latin = runCatching { transliterator.transliterate(raw) }.getOrDefault(raw)
        val normalized = Normalizer.normalize(latin, Normalizer.Form.NFD)
            .replace(COMBINING_MARKS_REGEX, "")
            .replace(NON_ALPHANUMERIC_REGEX, " ")
            .trim()
            .lowercase(Locale.ROOT)
        return normalized.ifEmpty {
            raw.lowercase(Locale.ROOT)
        }
    }

    fun compareStrings(left: String?, right: String?): Int {
        val leftSection = sectionSortOrder(sectionKey(left))
        val rightSection = sectionSortOrder(sectionKey(right))
        if (leftSection != rightSection) {
            return leftSection.compareTo(rightSection)
        }

        val keyCompare = sortKey(left).compareTo(sortKey(right))
        if (keyCompare != 0) {
            return keyCompare
        }

        return left.orEmpty().compareTo(right.orEmpty(), ignoreCase = true)
    }

    private fun sectionSortOrder(section: String): Int {
        return if (section == "#") {
            Int.MAX_VALUE
        } else {
            section.first().code
        }
    }

    private val COMBINING_MARKS_REGEX = Regex("\\p{InCombiningDiacriticalMarks}+")
    private val NON_ALPHANUMERIC_REGEX = Regex("[^\\p{Alnum}]+")
}
