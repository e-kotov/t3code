package expo.modules.t3citationpassage

import org.junit.Assert.*
import org.junit.Test

class CitationPassageObservationTest {
  @Test fun waitsForAsynchronousRenderedTextThenReportsThePassage() {
    val observation = CitationPassageObservation()
    observation.begin()
    assertEquals(CitationPassageObservation.Step.Wait, observation.update(1, null))
    assertEquals(CitationPassageObservation.Step.Wait, observation.update(1, null))
    val complete = observation.update(1, CitationPassageLocation(500.0)) as CitationPassageObservation.Step.Complete
    assertTrue(complete.emit)
    assertEquals(500.0, complete.report!!.delta)
  }

  @Test fun reattachmentDoesNotEmitAnotherScrollForTheSameActivation() {
    val observation = CitationPassageObservation()
    observation.begin()
    observation.update(1, CitationPassageLocation(500.0))
    observation.begin()
    val remount = observation.update(1, CitationPassageLocation(100.0)) as CitationPassageObservation.Step.Complete
    assertFalse(remount.emit)
    val newer = observation.update(2, CitationPassageLocation(100.0)) as CitationPassageObservation.Step.Complete
    assertTrue(newer.emit)
  }

  @Test fun missingOrPermanentlyUnlaidOutTextHasABoundedWait() {
    val observation = CitationPassageObservation(3)
    observation.begin()
    repeat(2) { assertEquals(CitationPassageObservation.Step.Wait, observation.update(1, null)) }
    val missing = observation.update(1, null) as CitationPassageObservation.Step.Complete
    assertTrue(missing.emit)
    assertNull(missing.report)
  }
}
