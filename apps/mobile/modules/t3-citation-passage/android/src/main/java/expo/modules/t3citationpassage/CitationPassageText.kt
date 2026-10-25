package expo.modules.t3citationpassage

internal data class CitationPassageRange(val start: Int, val end: Int)

internal object CitationPassageText {
  private val whitespace = Regex("[\\s\\p{Z}\\uFEFF]+")
  private data class Normalized(val text: String, val starts: List<Int>, val ends: List<Int>)

  private fun normalize(raw: String): Normalized {
    val text = StringBuilder()
    val starts = mutableListOf<Int>()
    val ends = mutableListOf<Int>()
    var cursor = 0
    for (space in whitespace.findAll(raw)) {
      for (index in cursor until space.range.first) {
        text.append(raw[index])
        starts.add(index)
        ends.add(index + 1)
      }
      text.append(' ')
      starts.add(space.range.first)
      ends.add(space.range.last + 1)
      cursor = space.range.last + 1
    }
    for (index in cursor until raw.length) {
      text.append(raw[index])
      starts.add(index)
      ends.add(index + 1)
    }
    return Normalized(text.toString(), starts, ends)
  }

  fun find(raw: String, quote: String, prefix: String, suffix: String): CitationPassageRange? {
    val normalized = normalize(raw)
    val text = normalized.text
    val wanted = whitespace.replace(quote, " ")
    if (wanted.isBlank()) return null
    val before = whitespace.replace(prefix, " ")
    val after = whitespace.replace(suffix, " ")
    val matches = mutableListOf<CitationPassageRange>()
    val contextual = mutableListOf<CitationPassageRange>()
    var start = text.indexOf(wanted)
    while (start >= 0) {
      val end = start + wanted.length
      val range = CitationPassageRange(start, end)
      matches.add(range)
      if (text.substring((start - before.length).coerceAtLeast(0), start) == before &&
        text.substring(end, (end + after.length).coerceAtMost(text.length)) == after) {
        contextual.add(range)
      }
      start = text.indexOf(wanted, start + 1)
    }
    val match = when {
      contextual.size == 1 -> contextual.single()
      contextual.size > 1 -> null
      matches.size == 1 -> matches.single()
      else -> null
    } ?: return null
    return CitationPassageRange(normalized.starts[match.start], normalized.ends[match.end - 1])
  }
}
