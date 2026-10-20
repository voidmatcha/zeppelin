/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.zeppelin.display;

import org.apache.thrift.TException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;


class AngularObjectRegistryTest {

  @Test
  // Compile the existing client API and verify that registry maps remain live views.
  @SuppressWarnings({"rawtypes", "unchecked"})
  void testLegacyRegistrySourceCompatibility() {
    AngularObjectRegistry registry = new AngularObjectRegistry("group", null);
    AngularObject<String> text = registry.add("text", "before", "note", null);
    text.set("after");
    AngularObject<String> found = registry.get("text", "note", null);
    assertSame(text, found);
    List<AngularObject> values = registry.getAll("note", null);
    assertSame(text, values.get(0));

    Map<String, Map<String, AngularObject>> live = registry.getRegistry();
    live.get("note").put("external", new AngularObject<>("external", true, "note", null, null));
    assertEquals(true, registry.get("external", "note", null).get());

    Map<String, Map<String, AngularObject>> replacement = new HashMap<>();
    registry.setRegistry(replacement);
    assertSame(replacement, registry.getRegistry());
    registry.add("count", 1, "note", null);
    assertEquals(1, replacement.get("note").get("count").get());
    AngularObject<Integer> removed = registry.remove("count", "note", null);
    assertEquals(1, removed.get());
  }

  @Test
  // A wildcard callback would reject this previously valid mutation in a listener lambda.
  @SuppressWarnings("unchecked")
  void testLegacyListenerCanReplaceValue() {
    AngularObjectListener listener = value -> value.set("replacement", false);
    AngularObject<String> value = new AngularObject<>("text", "before", "note", null, listener);
    value.set("trigger");
    assertEquals("replacement", value.get());
  }

  @Test
  void testBasic() throws TException {
    final AtomicInteger onAdd = new AtomicInteger(0);
    final AtomicInteger onUpdate = new AtomicInteger(0);
    final AtomicInteger onRemove = new AtomicInteger(0);

    AngularObjectRegistry registry = new AngularObjectRegistry("intpId",
        new AngularObjectRegistryListener() {

          @Override
          // Keep legacy AngularObject signatures compatible with existing callers.
          @SuppressWarnings("rawtypes")
          public void onAddAngularObject(String interpreterGroupId, AngularObject angularObject) {
            onAdd.incrementAndGet();
          }

          @Override
          // Keep legacy AngularObject signatures compatible with existing callers.
          @SuppressWarnings("rawtypes")
          public void onUpdateAngularObject(String interpreterGroupId, AngularObject angularObject) {
            onUpdate.incrementAndGet();
          }

          @Override
          // Keep legacy AngularObject signatures compatible with existing callers.
          @SuppressWarnings("rawtypes")
          public void onRemoveAngularObject(String interpreterGroupId, AngularObject angularObject) {
            onRemove.incrementAndGet();
          }
        });

    registry.add("name1", "value1", "note1", null);
    assertEquals(1, registry.getAll("note1", null).size());
    assertEquals(1, onAdd.get());
    assertEquals(0, onUpdate.get());

    registry.get("name1", "note1", null).set("newValue");
    assertEquals(1, onUpdate.get());

    registry.remove("name1", "note1", null);
    assertEquals(0, registry.getAll("note1", null).size());
    assertEquals(1, onRemove.get());

    assertEquals(null, registry.get("name1", "note1", null));

    // namespace
    registry.add("name1", "value11", "note2", null);
    assertEquals("value11", registry.get("name1", "note2", null).get());
    assertEquals(null, registry.get("name1", "note1", null));

    // null namespace
    registry.add("name1", "global1", null, null);
    assertEquals("global1", registry.get("name1", null, null).get());
  }

  @Test
  void testGetDependOnScope() throws TException {
    AngularObjectRegistry registry = new AngularObjectRegistry("intpId", null);
    AngularObject<Object> ao1 = registry.add("name1", "o1", "noteId1", "paragraphId1");
    AngularObject<Object> ao2 = registry.add("name2", "o2", "noteId1", "paragraphId1");
    AngularObject<Object> ao3 = registry.add("name2", "o3", "noteId1", "paragraphId2");
    AngularObject<Object> ao4 = registry.add("name3", "o4", "noteId1", null);
    AngularObject<Object> ao5 = registry.add("name4", "o5", null, null);


    assertNull(registry.get("name3", "noteId1", "paragraphId1"));
    assertNull(registry.get("name1", "noteId2", null));
    assertEquals("o1", registry.get("name1", "noteId1", "paragraphId1").get());
    assertEquals("o2", registry.get("name2", "noteId1", "paragraphId1").get());
    assertEquals("o3", registry.get("name2", "noteId1", "paragraphId2").get());
    assertEquals("o4", registry.get("name3", "noteId1", null).get());
    assertEquals("o5", registry.get("name4", null, null).get());
  }

  @Test
  void testGetAllDependOnScope() throws TException {
    AngularObjectRegistry registry = new AngularObjectRegistry("intpId", null);
    AngularObject<Object> ao1 = registry.add("name1", "o", "noteId1", "paragraphId1");
    AngularObject<Object> ao2 = registry.add("name2", "o", "noteId1", "paragraphId1");
    AngularObject<Object> ao3 = registry.add("name2", "o", "noteId1", "paragraphId2");
    AngularObject<Object> ao4 = registry.add("name3", "o", "noteId1", null);
    AngularObject<Object> ao5 = registry.add("name4", "o", null, null);

    assertEquals(2, registry.getAll("noteId1", "paragraphId1").size());
    assertEquals(1, registry.getAll("noteId1", "paragraphId2").size());
    assertEquals(1, registry.getAll("noteId1", null).size());
    assertEquals(1, registry.getAll(null, null).size());
    assertEquals(5, registry.getAllWithGlobal("noteId1").size());
  }

}
