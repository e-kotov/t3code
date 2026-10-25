package expo.modules.t3citationpassage

import org.junit.Assert.*
import org.junit.Test

class CitationPassageTextTest {
  @Test fun locatesQuoteDeepInResponse() {
    val raw = "Earlier paragraph.\n".repeat(100) + "The exact quoted passage.\nConclusion."
    val match = CitationPassageText.find(raw, "exact quoted passage", "The ", ".")!!
    assertEquals(raw.indexOf("exact quoted passage"), match.start)
    assertEquals("exact quoted passage", raw.substring(match.start, match.end))
  }

  @Test fun surroundingContextDisambiguatesRepeatedPhraseAcrossBlocks() {
    val raw = "First: repeated phrase ends.\nSecond: repeated phrase wins."
    val match = CitationPassageText.find(raw, "repeated phrase", "Second: ", " wins.")!!
    assertEquals(raw.lastIndexOf("repeated phrase"), match.start)
  }

  @Test fun refusesAmbiguousQuotesWithoutGuessingFromFragmentOffsets() {
    assertNull(CitationPassageText.find("same quote\nsame quote", "same quote", "", ""))
    assertNull(CitationPassageText.find("a quote b a quote b", "quote", "a ", " b"))
  }

  @Test fun uniqueQuoteSurvivesChangedOrMissingContext() {
    assertEquals(CitationPassageRange(7, 12), CitationPassageText.find("before quote after", "quote", "old", "old"))
  }

  @Test fun mapsNormalizedWhitespaceBackToRenderedUtf16IncludingEmoji() {
    val raw = "😀 before\n\nquoted\t  words\u00a0end"
    val match = CitationPassageText.find(raw, "quoted words", "😀 before ", " end")!!
    assertEquals(raw.indexOf("quoted"), match.start)
    assertEquals("quoted\t  words", raw.substring(match.start, match.end))
  }

  @Test fun resolvesQuoteAcrossRenderedParagraphsAndTableCells() {
    val raw = "First cell\nSecond cell\nThird paragraph"
    val match = CitationPassageText.find(raw, "cell Second cell Third", "First ", " paragraph")!!
    assertEquals("cell\nSecond cell\nThird", raw.substring(match.start, match.end))
  }

  @Test fun missingOrEmptyQuoteDoesNotHighlightAnotherPassage() {
    assertNull(CitationPassageText.find("original text", "removed", "", ""))
    assertNull(CitationPassageText.find("original text", " \n ", "", ""))
  }
}
